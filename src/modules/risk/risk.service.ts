import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  RiskAssessment,
  RiskDecision,
  assessRisk,
  checkVelocity,
  normalizeBlacklistValue,
  RiskEventPoint,
  VelocityLimit,
} from "./risk.util";

export type RiskSubjectKind =
  | "USER"
  | "DRIVER"
  | "PAYMENT"
  | "WITHDRAWAL"
  | "TRIP";

export type BlacklistKind = "USER" | "DEVICE" | "IP" | "PHONE" | "CARD";

export interface AssessActionInput {
  subjectKind: RiskSubjectKind;
  subjectId: string;
  action: string;
  amount?: number;
  avgAmount?: number;
  isNewDevice?: boolean;
  isNewAccount?: boolean;
  chargebackCount?: number;
  /** إشارات لفحص قائمة الحظر (جهاز/IP/هاتف/بطاقة). */
  blacklistChecks?: Array<{ kind: BlacklistKind; value: string }>;
  /** تاريخ أحداث لفحص السرعة + الحد. */
  velocity?: { history: RiskEventPoint[]; limit: VelocityLimit; now?: number };
}

/**
 * خدمة المخاطر والاحتيال: تربط المنطق النقي (`risk.util`) بالحالة
 * المخزّنة (قائمة حظر، حجوز، طابور مراجعة). كل تقييم يُسجّل كـ `RiskEvent`،
 * وقرار REVIEW يولّد عنصر طابور مراجعة (`RiskReview`).
 */
@Injectable()
export class RiskService {
  constructor(private readonly prisma: PrismaService) {}

  /** هل أي من قيم الفحص مدرج في قائمة حظر نشطة؟ */
  async isAnyBlacklisted(
    checks: Array<{ kind: BlacklistKind; value: string }>,
  ): Promise<boolean> {
    for (const c of checks) {
      const value = normalizeBlacklistValue(c.value);
      if (!value) continue;
      const hit = await this.prisma.blacklistEntry.findFirst({
        where: { kind: c.kind, value, active: true },
      });
      if (hit) return true;
    }
    return false;
  }

  /** هل يوجد حجز يدوي نشط على الكيان؟ */
  async hasActiveHold(
    subjectKind: RiskSubjectKind,
    subjectId: string,
  ): Promise<boolean> {
    const hold = await this.prisma.riskHold.findFirst({
      where: { subjectKind, subjectId, active: true },
    });
    return !!hold;
  }

  /**
   * تقييم إجراء: يجمع إشارات قاعدة البيانات (حظر/حجز) + السرعة ثم يطبّق
   * المنطق النقي، يسجّل `RiskEvent`، وينشئ مراجعة عند REVIEW.
   */
  async assess(input: AssessActionInput): Promise<RiskAssessment> {
    const blacklisted = input.blacklistChecks
      ? await this.isAnyBlacklisted(input.blacklistChecks)
      : false;
    const hasActiveHold = await this.hasActiveHold(
      input.subjectKind,
      input.subjectId,
    );

    const velocity = input.velocity
      ? checkVelocity(
          input.velocity.history,
          input.velocity.limit,
          input.velocity.now ?? Date.now(),
          input.amount !== undefined
            ? { at: input.velocity.now ?? Date.now(), amount: input.amount }
            : undefined,
        )
      : undefined;

    const assessment = assessRisk({
      amount: input.amount,
      avgAmount: input.avgAmount,
      velocity,
      isNewDevice: input.isNewDevice,
      isNewAccount: input.isNewAccount,
      blacklisted,
      hasActiveHold,
      chargebackCount: input.chargebackCount,
    });

    const event = await this.prisma.riskEvent.create({
      data: {
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        action: input.action,
        score: assessment.score,
        level: assessment.level,
        decision: assessment.decision,
        amount: input.amount ?? null,
        reasons: assessment.reasons as unknown as object,
      },
    });

    if (assessment.decision === "REVIEW") {
      await this.prisma.riskReview.create({
        data: {
          riskEventId: (event as any).id,
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          action: input.action,
          score: assessment.score,
          status: "OPEN",
        },
      });
    }

    return assessment;
  }

  // ----- قائمة الحظر -----
  async addBlacklist(
    kind: BlacklistKind,
    value: string,
    reason?: string,
    createdBy?: string,
  ) {
    const normalized = normalizeBlacklistValue(value);
    return this.prisma.blacklistEntry.upsert({
      where: { kind_value: { kind, value: normalized } },
      create: { kind, value: normalized, reason, active: true, createdBy },
      update: { reason, active: true },
    });
  }

  async removeBlacklist(kind: BlacklistKind, value: string) {
    const normalized = normalizeBlacklistValue(value);
    return this.prisma.blacklistEntry.updateMany({
      where: { kind, value: normalized },
      data: { active: false },
    });
  }

  async listBlacklist(kind?: BlacklistKind) {
    return this.prisma.blacklistEntry.findMany({
      where: { active: true, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  // ----- الحجز اليدوي -----
  async placeHold(
    subjectKind: RiskSubjectKind,
    subjectId: string,
    reason?: string,
    createdBy?: string,
  ) {
    return this.prisma.riskHold.create({
      data: { subjectKind, subjectId, reason, active: true, createdBy },
    });
  }

  async releaseHold(id: string, releasedBy?: string) {
    return this.prisma.riskHold.update({
      where: { id },
      data: { active: false, releasedBy, releasedAt: new Date() },
    });
  }

  async listHolds(active = true) {
    return this.prisma.riskHold.findMany({
      where: { active },
      orderBy: { createdAt: "desc" },
    });
  }

  // ----- طابور المراجعة -----
  async listReviews(status: "OPEN" | "APPROVED" | "REJECTED" = "OPEN") {
    return this.prisma.riskReview.findMany({
      where: { status },
      orderBy: { score: "desc" },
    });
  }

  async resolveReview(
    id: string,
    decision: "APPROVED" | "REJECTED",
    resolvedBy?: string,
    resolution?: string,
  ) {
    return this.prisma.riskReview.update({
      where: { id },
      data: {
        status: decision,
        resolvedBy,
        resolution,
        resolvedAt: new Date(),
      },
    });
  }

  // ----- سجل أحداث المخاطر -----
  async listEvents(opts: {
    page: number;
    limit: number;
    subjectKind?: string;
    decision?: string;
    subjectId?: string;
  }) {
    const { page, limit, subjectKind, decision, subjectId } = opts;
    const where = {
      ...(subjectKind ? { subjectKind } : {}),
      ...(decision ? { decision } : {}),
      ...(subjectId ? { subjectId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.riskEvent.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.riskEvent.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * ذكاء الاحتيال والإساءة (قراءة فقط) — يجمّع أحداث المخاطر
   * في إشارات قابلة للتنفيذ حسب الجهة دون تكرار السجلات الخام.
   */
  async fraudSignals(from?: string, to?: string) {
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from
      ? new Date(from)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const createdAt = { gte: fromDate, lte: toDate };

    const [
      decisionGroups,
      levelGroups,
      events,
      openReviews,
      activeHolds,
      blacklistEntries,
    ] = await this.prisma.$transaction([
      this.prisma.riskEvent.groupBy({
        by: ["decision"],
        where: { createdAt },
        _count: { _all: true },
      }),
      this.prisma.riskEvent.groupBy({
        by: ["level"],
        where: { createdAt },
        _count: { _all: true },
      }),
      this.prisma.riskEvent.findMany({
        where: { createdAt },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          subjectKind: true,
          subjectId: true,
          action: true,
          score: true,
          level: true,
          decision: true,
          amount: true,
          reasons: true,
          createdAt: true,
        },
      }),
      this.prisma.riskReview.count({ where: { status: "OPEN" } }),
      this.prisma.riskHold.count({ where: { active: true } }),
      this.prisma.blacklistEntry.count({ where: { active: true } }),
    ]);

    const decisions: Record<string, number> = { ALLOW: 0, REVIEW: 0, BLOCK: 0 };
    for (const g of decisionGroups) decisions[g.decision] = g._count._all;
    const levels: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const g of levelGroups) levels[g.level] = g._count._all;

    const bySubject = new Map<
      string,
      {
        subjectKind: string;
        subjectId: string;
        events: number;
        maxScore: number;
        blockCount: number;
        reviewCount: number;
        lastDecision: string;
        lastSeen: Date;
      }
    >();
    for (const e of events) {
      const key = `${e.subjectKind}:${e.subjectId}`;
      const cur = bySubject.get(key);
      if (!cur) {
        bySubject.set(key, {
          subjectKind: e.subjectKind,
          subjectId: e.subjectId,
          events: 1,
          maxScore: e.score,
          blockCount: e.decision === "BLOCK" ? 1 : 0,
          reviewCount: e.decision === "REVIEW" ? 1 : 0,
          lastDecision: e.decision,
          lastSeen: e.createdAt,
        });
      } else {
        cur.events += 1;
        cur.maxScore = Math.max(cur.maxScore, e.score);
        if (e.decision === "BLOCK") cur.blockCount += 1;
        if (e.decision === "REVIEW") cur.reviewCount += 1;
        if (e.createdAt > cur.lastSeen) {
          cur.lastSeen = e.createdAt;
          cur.lastDecision = e.decision;
        }
      }
    }
    const topSubjects = Array.from(bySubject.values())
      .sort(
        (a, b) =>
          b.maxScore - a.maxScore ||
          b.blockCount - a.blockCount ||
          b.events - a.events,
      )
      .slice(0, 20);

    const recentHighRisk = events
      .filter(
        (e) =>
          e.decision === "BLOCK" ||
          e.decision === "REVIEW" ||
          e.level === "HIGH",
      )
      .slice(0, 20);

    return {
      window: { from: fromDate.toISOString(), to: toDate.toISOString() },
      totals: {
        events: decisions.ALLOW + decisions.REVIEW + decisions.BLOCK,
        openReviews,
        activeHolds,
        blacklistEntries,
        flaggedSubjects: topSubjects.filter(
          (s) => s.blockCount > 0 || s.reviewCount > 0,
        ).length,
      },
      decisions,
      levels,
      topSubjects,
      recentHighRisk,
    };
  }

  /** أداة مساعدة: هل يجب منع الإجراء بناءً على القرار؟ */
  static shouldBlock(decision: RiskDecision): boolean {
    return decision === "BLOCK";
  }
}
