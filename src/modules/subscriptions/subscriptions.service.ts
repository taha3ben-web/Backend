import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, SubscriptionPlan, UserSubscription } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { FinancialService } from "../financial/financial.service";
import { CreatePlanDto, UpdatePlanDto } from "./dto/subscriptions.dto";
import { nextPeriodEnd } from "./subscriptions.util";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";

/** محاولات التجديد قبل اعتبار الاشتراك منتهيًا (فشل الخصم متكررًا). */
const MAX_RENEWAL_ATTEMPTS = 3;

/** لاحقة حساب إيراد الاشتراكات في دفتر الأستاذ (PLATFORM:SUBSCRIPTION:<currency>). */
const SUBSCRIPTION_REVENUE_SUFFIX = "SUBSCRIPTION";

/** منفعة اشتراك فعّال (data-only) لتستهلكها مراحل التسعير لاحقًا. */
export interface ActiveBenefit {
  subscriptionId: string;
  planCode: string;
  discountPct: number;
  maxDiscount: number | null;
  currentPeriodEnd: Date;
}

/**
 * يدير خطط الاشتراك ودورة حياة اشتراكات المستخدمين (اشتراك/إلغاء/تجديد/انتهاء).
 * الرسوم تُحصّل عبر دفتر الأستاذ (خصم محفظة الراكب -> إيراد المنصّة) فتبقى المحاسبة
 * مزدوجة القيد ومتوازنة. تطبيق منافع الخطة على التسعير خارج نطاق هذه المرحلة (يبقى مستقلاً).
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly cronLock: DistributedLockService,
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  // ---------- الخطط (Plans) ----------
  async listPlans(includeInactive = false): Promise<SubscriptionPlan[]> {
    return this.prisma.subscriptionPlan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
    });
  }

  async createPlan(dto: CreatePlanDto): Promise<SubscriptionPlan> {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.subscriptionPlan.findUnique({
      where: { code },
    });
    if (exists) throw new AppException("SUBSCRIPTION_PLAN_CODE_TAKEN");
    return this.prisma.subscriptionPlan.create({
      data: {
        code,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        currency: dto.currency ?? undefined,
        interval: dto.interval ?? undefined,
        benefitDiscountPct: dto.benefitDiscountPct ?? undefined,
        benefitMaxDiscount: dto.benefitMaxDiscount ?? null,
        perks: (dto.perks ?? undefined) as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<SubscriptionPlan> {
    await this.getPlanOrThrow(id);
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency,
        interval: dto.interval,
        benefitDiscountPct: dto.benefitDiscountPct,
        benefitMaxDiscount: dto.benefitMaxDiscount,
        perks:
          dto.perks === undefined
            ? undefined
            : (dto.perks as Prisma.InputJsonValue),
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async deactivatePlan(id: string): Promise<SubscriptionPlan> {
    await this.getPlanOrThrow(id);
    return this.prisma.subscriptionPlan.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async getPlanOrThrow(id: string): Promise<SubscriptionPlan> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });
    if (!plan) throw new AppException("SUBSCRIPTION_PLAN_NOT_FOUND");
    return plan;
  }

  // ---------- اشتراك المستخدم ----------
  async subscribe(userId: string, planId: string): Promise<UserSubscription> {
    const plan = await this.getPlanOrThrow(planId);
    if (!plan.isActive) throw new AppException("SUBSCRIPTION_PLAN_INACTIVE");

    const active = await this.findActive(userId);
    if (active) throw new AppException("SUBSCRIPTION_ALREADY_ACTIVE");

    const now = new Date();
    const periodEnd = nextPeriodEnd(now, plan.interval);
    const price = Number(plan.price);

    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.userSubscription.create({
        data: {
          userId,
          planId: plan.id,
          status: "ACTIVE",
          startedAt: now,
          currentPeriodEnd: periodEnd,
          autoRenew: true,
          lastChargedAt: price > 0 ? now : null,
        },
      });
      if (price > 0) {
        await this.financial.chargeWalletFee(tx, {
          userId,
          amount: price,
          currency: plan.currency,
          revenueSuffix: SUBSCRIPTION_REVENUE_SUFFIX,
          referenceType: "SUBSCRIPTION",
          referenceId: sub.id,
          reason: `Subscription ${plan.code} initial charge`,
          idempotencyKey: `subscription:initial:${sub.id}`,
        });
      }
      return sub;
    });
  }

  async cancel(
    userId: string,
    subscriptionId?: string,
  ): Promise<UserSubscription> {
    const sub = subscriptionId
      ? await this.prisma.userSubscription.findUnique({
          where: { id: subscriptionId },
        })
      : await this.findActive(userId);
    if (!sub || sub.userId !== userId) {
      throw new AppException("SUBSCRIPTION_NOT_FOUND");
    }
    if (sub.status !== "ACTIVE") {
      throw new AppException("SUBSCRIPTION_NOT_ACTIVE");
    }
    // إيقاف التجديد التلقائي فقط: يبقى الاشتراك فعّالًا حتى نهاية الفترة المدفوعة.
    return this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { autoRenew: false, cancelledAt: new Date() },
    });
  }

  /** اشتراك فعّال غير منتهٍ للمستخدم (إن وجد). */
  async findActive(userId: string): Promise<UserSubscription | null> {
    return this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        currentPeriodEnd: { gt: new Date() },
      },
      orderBy: { currentPeriodEnd: "desc" },
    });
  }

  async getMySubscription(userId: string) {
    return this.prisma.userSubscription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
  }

  /** منفعة الاشتراك الفعّالة (data-only) — تستهلكها مراحل التسعير لاحقًا. */
  async getActiveBenefit(userId: string): Promise<ActiveBenefit | null> {
    const sub = await this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        currentPeriodEnd: { gt: new Date() },
      },
      orderBy: { currentPeriodEnd: "desc" },
      include: { plan: true },
    });
    if (!sub) return null;
    return {
      subscriptionId: sub.id,
      planCode: sub.plan.code,
      discountPct: sub.plan.benefitDiscountPct,
      maxDiscount:
        sub.plan.benefitMaxDiscount != null
          ? Number(sub.plan.benefitMaxDiscount)
          : null,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
  }

  // ---------- إدارة (STAFF) ----------
  async adminList(q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userSubscription.findMany({
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          plan: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.userSubscription.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  // ---------- التجديد التلقائي (Cron) ----------
  /**
   * يجدّد الاشتراكات المستحقة (currentPeriodEnd <= now):
   * - autoRenew=false -> يُعلّم EXPIRED.
   * - autoRenew=true  -> يخصم الرسم ويمدّد الفترة؛ وعند فشل الخصم يزيد المحاولات
   *      وينتهي بعد MAX_RENEWAL_ATTEMPTS. الخصم والتمديد ذريّان (معاملة واحدة) وidempotent.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async renewDueSubscriptions(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:subscriptions-renew",
      () => this.renewDueSubscriptionsTask(),
      600000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async renewDueSubscriptionsTask(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.userSubscription.findMany({
      where: { status: "ACTIVE", currentPeriodEnd: { lte: now } },
      include: { plan: true },
      take: 200,
    });
    for (const sub of due) {
      try {
        if (!sub.autoRenew) {
          await this.prisma.userSubscription.update({
            where: { id: sub.id },
            data: { status: "EXPIRED" },
          });
          continue;
        }
        const price = Number(sub.plan.price);
        const periodEnd = nextPeriodEnd(
          sub.currentPeriodEnd,
          sub.plan.interval,
        );
        await this.prisma.$transaction(async (tx) => {
          if (price > 0) {
            await this.financial.chargeWalletFee(tx, {
              userId: sub.userId,
              amount: price,
              currency: sub.plan.currency,
              revenueSuffix: SUBSCRIPTION_REVENUE_SUFFIX,
              referenceType: "SUBSCRIPTION",
              referenceId: sub.id,
              reason: `Subscription ${sub.plan.code} renewal`,
              idempotencyKey: `subscription:renew:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
            });
          }
          await tx.userSubscription.update({
            where: { id: sub.id },
            data: {
              currentPeriodEnd: periodEnd,
              lastChargedAt: price > 0 ? now : sub.lastChargedAt,
              renewalAttempts: 0,
              renewalError: null,
            },
          });
        });
      } catch (error) {
        const attempts = sub.renewalAttempts + 1;
        const expired = attempts >= MAX_RENEWAL_ATTEMPTS;
        await this.prisma.userSubscription
          .update({
            where: { id: sub.id },
            data: {
              renewalAttempts: attempts,
              renewalError:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : "renewal failed",
              status: expired ? "EXPIRED" : "ACTIVE",
            },
          })
          .catch(() => undefined);
        this.logger.warn(
          `Subscription renewal failed for ${sub.id} (attempt ${attempts}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
