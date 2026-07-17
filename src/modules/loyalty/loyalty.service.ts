import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, LoyaltyAccount } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { FinancialService } from "../financial/financial.service";
import {
  computeEarnedPoints,
  parseLoyaltyConfig,
  pointsToCurrency,
  resolveTier,
} from "./loyalty.util";

export interface EarnInput {
  points: number;
  type?: "EARN" | "ADJUST";
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey: string;
}

export interface RedeemResult {
  redeemed: boolean;
  points: number;
  amount: number;
  currency: string;
  pointsBalance: number;
}

/**
 * نظام الولاء (Loyalty): كسب النقاط، حساب الفئة، واستبدالها برصيد محفظة
 * — عبر grantPromotionalCredit القائم (إعادة استخدام، بلا تكرار محاسبي).
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  /** يعيد (أو يُنشئ) حساب ولاء المستخدم. */
  async getOrCreateAccount(userId: string): Promise<LoyaltyAccount> {
    return this.prisma.loyaltyAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * يضيف نقاطًا (idempotent عبر idempotencyKey الفريد). يحدّث الرصيد، النقاط
   * التراكمية، والفئة ضمن معاملة واحدة. يدعم قيمًا موجبة (كسب) وسالبة (تعديل إداري).
   */
  async earn(userId: string, input: EarnInput): Promise<LoyaltyAccount> {
    const cfg = parseLoyaltyConfig(process.env);
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      // idempotency: إن وُجد المفتاح مسبقًا فلا تكرار.
      const existing = await tx.loyaltyLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return account;

      await tx.loyaltyLedger.create({
        data: {
          accountId: account.id,
          type: input.type ?? "EARN",
          points: input.points,
          reason: input.reason ?? null,
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey,
        },
      });

      // النقاط التراكمية تزداد فقط بالكسب الموجب (لا تنخفض بالخصم/الاستبدال).
      const lifetimeDelta = input.points > 0 ? input.points : 0;
      const lifetimePoints = account.lifetimePoints + lifetimeDelta;
      const tier = resolveTier(lifetimePoints, cfg.tierThresholds);

      return tx.loyaltyAccount.update({
        where: { id: account.id },
        data: {
          pointsBalance: { increment: input.points },
          lifetimePoints,
          tier,
        },
      });
    });
  }

  /**
   * يكسب نقاطًا من رحلة مكتملة حسب المبلغ المدفوع. نقطة التكامل المستقبلية
   * مع تسوية الرحلة. idempotent لكل رحلة.
   */
  async earnFromTrip(
    userId: string,
    tripAmountMajor: number,
    tripId: string,
  ): Promise<number> {
    const cfg = parseLoyaltyConfig(process.env);
    if (!cfg.enabled) return 0;
    const points = computeEarnedPoints(tripAmountMajor, cfg.pointsPerCurrencyUnit);
    if (points <= 0) return 0;
    await this.earn(userId, {
      points,
      type: "EARN",
      reason: `Trip reward ${tripId}`,
      referenceType: "TRIP",
      referenceId: tripId,
      idempotencyKey: `loyalty:earn:trip:${tripId}`,
    });
    return points;
  }

  /** استبدال النقاط برصيد محفظة (ضمن معاملة واحدة ذرية). */
  async redeem(userId: string, points: number): Promise<RedeemResult> {
    const cfg = parseLoyaltyConfig(process.env);
    if (!cfg.enabled) throw new AppException("LOYALTY_DISABLED");
    if (!Number.isInteger(points) || points < cfg.minRedeemPoints) {
      throw new AppException("LOYALTY_MIN_REDEEM");
    }

    const amount = pointsToCurrency(points, cfg.redeemPointsPerUnit);
    if (amount <= 0) throw new AppException("LOYALTY_MIN_REDEEM");

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      if (account.pointsBalance < points) {
        throw new AppException("LOYALTY_INSUFFICIENT_POINTS");
      }

      const entry = await tx.loyaltyLedger.create({
        data: {
          accountId: account.id,
          type: "REDEEM",
          points: -points,
          reason: `Redeemed ${points} points`,
          referenceType: "LOYALTY_REDEEM",
          referenceId: null,
          idempotencyKey: `loyalty:redeem:${randomUUID()}`,
        },
      });

      const updated = await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { pointsBalance: { decrement: points } },
      });

      await this.financial.grantPromotionalCredit(tx, {
        userId,
        amount,
        currency: cfg.currency,
        referenceType: "LOYALTY_REDEEM",
        referenceId: entry.id,
        reason: `Loyalty redemption ${entry.id}`,
        idempotencyKey: `loyalty:redeem:${entry.id}`,
      });

      return {
        redeemed: true,
        points,
        amount,
        currency: cfg.currency,
        pointsBalance: updated.pointsBalance,
      };
    });
  }

  /** تعديل إداري للنقاط (موجب/سالب). */
  async adjust(
    userId: string,
    points: number,
    reason?: string,
  ): Promise<LoyaltyAccount> {
    if (!Number.isInteger(points) || points === 0) {
      throw new AppException("VALIDATION_ERROR", {
        message: "points must be a non-zero integer",
      });
    }
    return this.earn(userId, {
      points,
      type: "ADJUST",
      reason: reason ?? "Manual adjustment",
      idempotencyKey: `loyalty:adjust:${randomUUID()}`,
    });
  }

  /** رصيد المستخدم الحالي. */
  async getBalance(userId: string): Promise<LoyaltyAccount> {
    return this.getOrCreateAccount(userId);
  }

  /** سجل حركات المستخدم. */
  async history(userId: string, q: PaginationDto) {
    const account = await this.getOrCreateAccount(userId);
    const where: Prisma.LoyaltyLedgerWhereInput = { accountId: account.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loyaltyLedger.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.loyaltyLedger.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** قائمة إدارية بحسابات الولاء. */
  async findAll(q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.loyaltyAccount.findMany({
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { lifetimePoints: "desc" },
      }),
      this.prisma.loyaltyAccount.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
