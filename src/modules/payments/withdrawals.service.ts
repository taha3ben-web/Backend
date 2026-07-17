import { Injectable, Optional } from "@nestjs/common";
import { Prisma, WithdrawStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";
import { round2 } from "../../common/money.util";
import { RiskService } from "../risk/risk.service";
import { TracerService } from "../../common/observability/tracer.service";
import { AppException } from "../../common/api/app.exception";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";
import {
  canWithdrawalTransition,
  type WithdrawalStatus,
} from "./withdrawal-transitions";

/** حدود سرعة السحب لكشف الاحتيال (نافذة 24 ساعة). */
const WITHDRAWAL_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const WITHDRAWAL_VELOCITY_MAX_COUNT = 5;

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
    private readonly risk: RiskService,
    @Optional() private readonly tracer?: TracerService,
    @Optional() private readonly lock?: DistributedLockService,
  ) {}

  private withTrace<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer
      ? this.tracer.withSpan(name, async () => fn(), attributes)
      : fn();
  }

  private withTransitionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.lock
      ? this.lock.withLock(`withdrawal:transition:${id}`, fn)
      : fn();
  }

  private async findWithdrawal(id: string) {
    const request = await this.prisma.withdrawRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new AppException("WITHDRAWAL_NOT_FOUND", { details: { id } });
    }
    return request;
  }

  private assertTransition(
    id: string,
    from: WithdrawalStatus,
    to: WithdrawalStatus,
  ): void {
    if (!canWithdrawalTransition(from, to)) {
      throw new AppException("INVALID_WITHDRAWAL_TRANSITION", {
        details: { id, from, to },
      });
    }
  }

  private async transition(
    id: string,
    from: WithdrawalStatus,
    to: WithdrawalStatus,
    actorId: string,
    note?: string,
  ) {
    this.assertTransition(id, from, to);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.withdrawRequest.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          processedById: actorId,
          processedAt: new Date(),
          note: note ?? undefined,
        },
      });
      if (changed.count !== 1) {
        const current = await tx.withdrawRequest.findUnique({ where: { id } });
        if (!current) {
          throw new AppException("WITHDRAWAL_NOT_FOUND", { details: { id } });
        }
        throw new AppException("INVALID_WITHDRAWAL_TRANSITION", {
          details: { id, expectedFrom: from, actualFrom: current.status, to },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: "WITHDRAWAL_STATUS_CHANGED",
          entity: "WithdrawRequest",
          entityId: id,
          meta: { from, to, note: note ?? null },
        },
      });

      const updated = await tx.withdrawRequest.findUnique({ where: { id } });
      if (!updated) {
        throw new AppException("WITHDRAWAL_NOT_FOUND", { details: { id } });
      }
      return updated;
    });
  }

  async findAll(q: PaginationDto, status?: WithdrawStatus, search?: string) {
    const where = this.buildWhere(status, search);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          driver: { select: { id: true } },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async summary(status?: WithdrawStatus, search?: string) {
    const where = this.buildWhere(status, search);
    const [
      totalCount,
      totalAmount,
      pendingCount,
      approvedCount,
      paidCount,
      rejectedCount,
    ] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.count({ where }),
      this.prisma.withdrawRequest.aggregate({ where, _sum: { amount: true } }),
      this.prisma.withdrawRequest.count({
        where: { ...where, status: "PENDING" },
      }),
      this.prisma.withdrawRequest.count({
        where: { ...where, status: "APPROVED" },
      }),
      this.prisma.withdrawRequest.count({
        where: { ...where, status: "PAID" },
      }),
      this.prisma.withdrawRequest.count({
        where: { ...where, status: "REJECTED" },
      }),
    ]);

    return {
      totalCount,
      totalAmount: Number(totalAmount._sum.amount ?? 0),
      pendingCount,
      approvedCount,
      paidCount,
      rejectedCount,
    };
  }

  /**
   * نزاهة أرباح السائقين والدفعات (قراءة فقط) — يطابق صافي
   * أرباح كل سائق (DriverEarning.net) مع المسحوب فعليًا والمعلّق،
   * ويُبرز الفجوات دون تكرار السجلات الخام.
   */
  async payoutIntegrity(limit = 50) {
    const [earnGroups, withdrawGroups, drivers] =
      await this.prisma.$transaction([
        this.prisma.driverEarning.groupBy({
          by: ["driverId"],
          orderBy: { driverId: "asc" },
          _sum: { net: true, gross: true, commission: true },
          _count: { _all: true },
        }),
        this.prisma.withdrawRequest.groupBy({
          by: ["driverId", "status"],
          orderBy: [{ driverId: "asc" }, { status: "asc" }],
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.driver.findMany({
          select: {
            id: true,
            userId: true,
            user: { select: { name: true, phone: true } },
          },
        }),
      ]);

    const driverMap = new Map(drivers.map((d) => [d.id, d]));

    type Row = {
      driverId: string;
      name: string | null;
      phone: string | null;
      trips: number;
      netEarnings: number;
      grossEarnings: number;
      commission: number;
      paid: number;
      pending: number;
      rejected: number;
      available: number;
      gap: number;
      flags: string[];
    };

    const rows = new Map<string, Row>();
    const ensure = (driverId: string): Row => {
      let r = rows.get(driverId);
      if (!r) {
        const d = driverMap.get(driverId);
        r = {
          driverId,
          name: d?.user?.name ?? null,
          phone: d?.user?.phone ?? null,
          trips: 0,
          netEarnings: 0,
          grossEarnings: 0,
          commission: 0,
          paid: 0,
          pending: 0,
          rejected: 0,
          available: 0,
          gap: 0,
          flags: [],
        };
        rows.set(driverId, r);
      }
      return r;
    };

    for (const g of earnGroups) {
      const r = ensure(g.driverId);
      r.netEarnings = Number(g._sum?.net ?? 0);
      r.grossEarnings = Number(g._sum?.gross ?? 0);
      r.commission = Number(g._sum?.commission ?? 0);
      r.trips =
        typeof g._count === "object" ? (g._count._all ?? 0) : 0;
    }
    for (const g of withdrawGroups) {
      const r = ensure(g.driverId);
      const amt = Number(g._sum?.amount ?? 0);
      if (g.status === "PAID") r.paid += amt;
      else if (g.status === "PENDING" || g.status === "APPROVED")
        r.pending += amt;
      else if (g.status === "REJECTED") r.rejected += amt;
    }

    for (const r of rows.values()) {
      r.gap = round2(r.netEarnings - r.paid);
      r.available = round2(r.netEarnings - r.paid - r.pending);
      r.netEarnings = round2(r.netEarnings);
      r.grossEarnings = round2(r.grossEarnings);
      r.commission = round2(r.commission);
      r.paid = round2(r.paid);
      r.pending = round2(r.pending);
      r.rejected = round2(r.rejected);
      if (r.paid > r.netEarnings + 0.005) r.flags.push("PAID_EXCEEDS_EARNED");
      if (r.available < -0.005) r.flags.push("NEGATIVE_AVAILABLE");
      if (r.pending > 0 && r.netEarnings <= 0)
        r.flags.push("WITHDRAW_WITHOUT_EARNINGS");
    }

    const all = Array.from(rows.values());
    const totals = {
      drivers: all.length,
      netEarnings: round2(all.reduce((sum, r) => sum + r.netEarnings, 0)),
      paid: round2(all.reduce((sum, r) => sum + r.paid, 0)),
      pending: round2(all.reduce((sum, r) => sum + r.pending, 0)),
      available: round2(all.reduce((sum, r) => sum + r.available, 0)),
      flagged: all.filter((r) => r.flags.length > 0).length,
    };

    const items = all
      .sort(
        (a, b) =>
          b.flags.length - a.flags.length || Math.abs(b.gap) - Math.abs(a.gap),
      )
      .slice(0, Math.min(200, Math.max(1, limit)));

    return { totals, items };
  }

  /**
   * مُقترح تسوية دفعات السائقين (قراءة فقط) — يفحص طلبات
   * السحب قيد التنفيذ (PENDING/APPROVED) ويقرّر ما إذا كانت
   * مغطّاة بصافي أرباح السائق المتاح، مُنتجًا دفعة مقترحة
   * قابلة للتنفيذ عبر مسارات الاعتماد/الدفع الحالية (بلا تحريك
   * أموال أو تعديل مخطط). Ledger يبقى مصدر الحقيقة.
   */
  async settlementProposal(limit = 100) {
    const cap = Math.min(500, Math.max(1, limit));
    const [inflight, earnGroups, paidGroups] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.findMany({
        where: { status: { in: ["PENDING", "APPROVED"] } },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { name: true, phone: true } },
          driver: { select: { id: true } },
        },
      }),
      this.prisma.driverEarning.groupBy({
        by: ["driverId"],
        orderBy: { driverId: "asc" },
        _sum: { net: true },
      }),
      this.prisma.withdrawRequest.groupBy({
        by: ["driverId"],
        where: { status: "PAID" },
        orderBy: { driverId: "asc" },
        _sum: { amount: true },
      }),
    ]);

    const netMap = new Map(
      earnGroups.map((g) => [g.driverId, Number(g._sum?.net ?? 0)]),
    );
    const paidMap = new Map(
      paidGroups.map((g) => [g.driverId, Number(g._sum?.amount ?? 0)]),
    );
    // الرصيد المتبقّي القابل للتغطية لكل سائق (يُستهلك تدريجيًا).
    const backing = new Map<string, number>();
    const backingOf = (driverId: string): number => {
      if (!backing.has(driverId)) {
        const net = netMap.get(driverId) ?? 0;
        const paid = paidMap.get(driverId) ?? 0;
        backing.set(driverId, net - paid);
      }
      return backing.get(driverId) as number;
    };

    type Recommendation =
      | "APPROVE"
      | "PAY"
      | "HOLD_INSUFFICIENT"
      | "REVIEW_RISK";
    type Item = {
      id: string;
      driverId: string;
      name: string | null;
      phone: string | null;
      status: WithdrawStatus;
      amount: number;
      backedAmount: number;
      shortfall: number;
      recommendation: Recommendation;
      flags: string[];
    };

    const items: Item[] = [];
    for (const w of inflight) {
      const amount = Number(w.amount);
      const remaining = backingOf(w.driverId);
      const backed = Math.max(0, Math.min(amount, remaining));
      backing.set(w.driverId, round2(remaining - backed));
      const shortfall = round2(amount - backed);
      const net = netMap.get(w.driverId) ?? 0;
      const paid = paidMap.get(w.driverId) ?? 0;
      const risky = net <= 0 || paid > net + 0.005;

      const flags: string[] = [];
      if (shortfall > 0.005) flags.push("INSUFFICIENT_FUNDS");
      if (risky) flags.push("DRIVER_RISK");

      let recommendation: Recommendation;
      if (shortfall > 0.005) recommendation = "HOLD_INSUFFICIENT";
      else if (risky) recommendation = "REVIEW_RISK";
      else if (w.status === "PENDING") recommendation = "APPROVE";
      else recommendation = "PAY";

      items.push({
        id: w.id,
        driverId: w.driverId,
        name: w.user?.name ?? null,
        phone: w.user?.phone ?? null,
        status: w.status,
        amount: round2(amount),
        backedAmount: round2(backed),
        shortfall,
        recommendation,
        flags,
      });
    }

    const sumBy = (pred: (i: Item) => boolean) =>
      round2(items.filter(pred).reduce((s, i) => s + i.amount, 0));
    const totals = {
      requests: items.length,
      drivers: new Set(items.map((i) => i.driverId)).size,
      totalAmount: sumBy(() => true),
      readyToApprove: items.filter((i) => i.recommendation === "APPROVE").length,
      readyToApproveAmount: sumBy((i) => i.recommendation === "APPROVE"),
      readyToPay: items.filter((i) => i.recommendation === "PAY").length,
      readyToPayAmount: sumBy((i) => i.recommendation === "PAY"),
      hold: items.filter((i) => i.recommendation === "HOLD_INSUFFICIENT").length,
      holdAmount: sumBy((i) => i.recommendation === "HOLD_INSUFFICIENT"),
      review: items.filter((i) => i.recommendation === "REVIEW_RISK").length,
      reviewAmount: sumBy((i) => i.recommendation === "REVIEW_RISK"),
    };

    const order: Record<Recommendation, number> = {
      PAY: 0,
      APPROVE: 1,
      REVIEW_RISK: 2,
      HOLD_INSUFFICIENT: 3,
    };
    const sorted = items
      .sort(
        (a, b) =>
          order[a.recommendation] - order[b.recommendation] ||
          b.amount - a.amount,
      )
      .slice(0, cap);

    return { totals, items: sorted };
  }

  async createForDriver(
    userId: string,
    amount: number,
    note?: string,
    idempotencyKey?: string,
  ) {
    return this.withTrace(
      "withdrawals.create_request",
      {
        userId,
        amount,
        idempotencyKey: idempotencyKey ?? null,
      },
      async () => {
        const driver = await this.prisma.driver.findUnique({
          where: { userId },
          include: { user: { select: { phone: true } } },
        });
        if (!driver) {
          throw new AppException("DRIVER_NOT_FOUND", { details: { userId } });
        }

        if (idempotencyKey) {
          const existing = await this.prisma.withdrawRequest.findUnique({
            where: { idempotencyKey },
          });
          if (existing) return existing;
        }

        await this.assessWithdrawalRisk(userId, amount, driver.user?.phone);

        const request = await this.prisma.withdrawRequest.create({
          data: {
            driverId: driver.id,
            userId,
            amount,
            note,
            idempotencyKey,
            status: "PENDING",
          },
        });
        try {
          await this.financial.reserveWithdrawal(request.id);
        } catch (error) {
          await this.prisma.withdrawRequest.delete({
            where: { id: request.id },
          });
          throw error;
        }
        return request;
      },
    );
  }

  async approve(id: string, processedById: string, note?: string) {
    return this.withTransitionLock(id, async () => {
      const request = await this.findWithdrawal(id);
      this.assertTransition(id, request.status, "APPROVED");
      return this.transition(
        id,
        request.status,
        "APPROVED",
        processedById,
        note,
      );
    });
  }

  async markPaid(id: string, processedById: string, note?: string) {
    return this.withTransitionLock(id, async () => {
      const request = await this.findWithdrawal(id);
      this.assertTransition(id, request.status, "PAID");
      await this.financial.completeWithdrawal(id);
      return this.transition(id, request.status, "PAID", processedById, note);
    });
  }

  async reject(id: string, processedById: string, note?: string) {
    return this.withTransitionLock(id, async () => {
      const request = await this.findWithdrawal(id);
      this.assertTransition(id, request.status, "REJECTED");
      await this.financial.releaseWithdrawal(id);
      return this.transition(
        id,
        request.status,
        "REJECTED",
        processedById,
        note,
      );
    });
  }

  /**
   * تقييم مخاطر طلب السحب قبل إنشائه. يجمع تاريخ السحب الأخير (للسرعة)
   * ومتوسّط المبالغ (لكشف الشذوذ) ثم يفوّض إلى `RiskService.assess`.
   * قرار BLOCK يرفض الطلب فورًا؛ REVIEW يُسجَّل في طابور المراجعة ويُسمح.
   */
  private async assessWithdrawalRisk(
    userId: string,
    amount: number,
    phone?: string | null,
  ): Promise<void> {
    const now = Date.now();
    const since = new Date(now - WITHDRAWAL_VELOCITY_WINDOW_MS);
    const [recent, avg] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { userId },
        _avg: { amount: true },
      }),
    ]);

    const history = recent.map((r) => ({
      at: r.createdAt.getTime(),
      amount: Number(r.amount),
    }));
    const avgAmount = Number(avg._avg.amount ?? 0) || undefined;

    const blacklistChecks: Array<{ kind: "USER" | "PHONE"; value: string }> = [
      { kind: "USER", value: userId },
    ];
    if (phone) blacklistChecks.push({ kind: "PHONE", value: phone });

    const assessment = await this.risk.assess({
      subjectKind: "USER",
      subjectId: userId,
      action: "withdrawal.create",
      amount,
      avgAmount,
      blacklistChecks,
      velocity: {
        history,
        limit: {
          windowMs: WITHDRAWAL_VELOCITY_WINDOW_MS,
          maxCount: WITHDRAWAL_VELOCITY_MAX_COUNT,
        },
        now,
      },
    });

    if (RiskService.shouldBlock(assessment.decision)) {
      throw new AppException("RISK_BLOCKED", {
        details: { action: "withdrawal.create" },
      });
    }
  }

  private buildWhere(
    status?: WithdrawStatus,
    search?: string,
  ): Prisma.WithdrawRequestWhereInput {
    return {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { phone: { contains: search, mode: "insensitive" } } },
              { note: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }
}
