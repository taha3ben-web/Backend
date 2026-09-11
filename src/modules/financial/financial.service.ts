import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { PostingLine } from "./financial.types";
import {
  planCommissionFunding,
  prepaidCommissionRequirement,
} from "../trips/settlement.util";
import type { CouponFundingSource } from "../trips/settlement.util";
import { buildFareBreakdown } from "../pricing-engine/fare-breakdown.util";
import {
  PRICING_FEES_SETTING_KEY,
  DEFAULT_PRICING_FEES,
  normalizePricingFees,
  waitingPolicyFrom,
  type PricingFeesSetting,
} from "../pricing-engine/pricing-policy.service";
import {
  ARRIVAL_EVENT_TYPE,
  computeWaitingSeconds,
} from "../trips/waiting-time.util";
import {
  DEFAULT_CURRENCY,
  round2,
  toMinorUnits,
} from "../../common/money.util";
import { accountBalanceDifference, isReconciled } from "./reconciliation.util";
import {
  canSettlementTransition,
  type SettlementStatus,
} from "../trips/settlement-transitions";
import { OutboxService } from "../../common/infra/outbox.service";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";
import { AlertService } from "../../common/observability/alert.service";
import { CountryConfigService } from "../country-config/country-config.service";
import { TracerService } from "../../common/observability/tracer.service";
import { AppException } from "../../common/api/app.exception";
import { LedgerCoreService } from "./ledger-core.service";

const DRIVER_CANCELLATION_PENALTY_KEY = "trips.driverCancellationPenaltyPct";
const DEFAULT_DRIVER_CANCELLATION_PENALTY_PCT = 0;

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly lock: DistributedLockService,
    private readonly ledger: LedgerCoreService,
    @Optional() private readonly countryConfig?: CountryConfigService,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly tracer?: TracerService,
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

  /**
   * يمنح رصيدًا ترويجيًا لمحفظة مستخدم عبر إدخال مزدوج متوازن ضمن معاملة قائمة:
   *   DEBIT  حساب مصروف الترويج (PLATFORM:PROMOTIONS — EXPENSE)
   *   CREDIT محفظة المستخدم (USER:...:AVAILABLE — LIABILITY)
   * يعيد استخدام post/userAccount/platformAccount (بلا تكرار) وهو idempotent عبر idempotencyKey.
   * إضافي بالكامل: لا يغير أي سلوك مالي قائم. يُستدعى من داخل معاملة المُستدعي ليبقى ذريًا مع عمله.
   */
  async grantPromotionalCredit(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      amount: number;
      currency: string;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      idempotencyKey: string;
      /** حساب المصروف المقابل. افتراضيًا PROMOTIONS فلا يتغير أي مستدعٍ قائم. */
      expenseSuffix?: string;
      /** اسم الأمر في الدفتر، لتمييز الإيداع الإداري عن المنحة الترويجية. */
      command?: string;
    },
  ): Promise<void> {
    this.ledger.assertCurrency(input.currency);
    if (!Number.isFinite(input.amount) || toMinorUnits(input.amount) <= 0) {
      throw new BadRequestException("Promotional credit must be positive");
    }
    const userAcc = await this.ledger.userAccount(
      tx,
      input.userId,
      input.currency,
    );
    const promoExpense = await this.ledger.platformAccount(
      tx,
      input.expenseSuffix ?? "PROMOTIONS",
      "EXPENSE",
      input.currency,
    );
    await this.ledger.post(tx, {
      command: input.command ?? "grantPromotionalCredit",
      idempotencyKey: input.idempotencyKey,
      currency: input.currency,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      lines: [
        {
          accountId: promoExpense.id,
          direction: "DEBIT",
          amount: input.amount,
        },
        { accountId: userAcc.id, direction: "CREDIT", amount: input.amount },
      ],
    });
  }

  /**
   * إيداع يدوي في محفظة مستخدم ينفّذه موظّف من لوحة التحكم.
   *
   * لا يوجد شحن ذاتي للمحفظة اليوم لأن بوّابات الدفع لم تُفعّل بعد، وكان
   * الرصيد يدخل المحفظة عبر الولاء/الإحالات/الرموز الترويجية فقط — أي أن الإدارة
   * لم تكن تملك أي وسيلة لتغذية محفظة أو تعويض راكب. قيد مزدوج متوازن:
   *   DEBIT  PLATFORM:GOODWILL (EXPENSE) — لا PROMOTIONS، فالإيداع الإداري ليس حملة ترويج
   *   CREDIT محفظة المستخدم (USER:...:AVAILABLE)
   * يعيد استخدام grantPromotionalCredit/post القائمين بلا نظام موازٍ، وهو
   * idempotent عبر مرجع العملية فلا تُكرّر نقرة مزدوجة الإيداع.
   */
  async adminCreditWallet(input: {
    userId: string;
    amount: number;
    currency?: string;
    reason: string;
    performedBy: string;
    reference?: string;
  }): Promise<{ credited: true; balance: number; currency: string }> {
    const currency = (input.currency ?? DEFAULT_CURRENCY).toUpperCase();
    if (!Number.isFinite(input.amount) || toMinorUnits(input.amount) <= 0) {
      throw new BadRequestException("قيمة الإيداع يجب أن تكون أكبر من صفر");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("سبب الإيداع مطلوب للتدقيق");
    }
    // مفتاح الخمول: مرجع صريح من الواجهة إن وُجد، وإلا مرجع مشتق يمنع
    // الإيداع المزدوج من نقرة مكررة خلال الدقيقة نفسها.
    const reference =
      input.reference?.trim() ||
      `${input.userId}:${toMinorUnits(input.amount)}:${new Date()
        .toISOString()
        .slice(0, 16)}`;
    await this.prisma.$transaction(
      async (tx) => {
        await this.grantPromotionalCredit(tx, {
          userId: input.userId,
          amount: input.amount,
          currency,
          referenceType: "ADMIN_CREDIT",
          referenceId: input.performedBy,
          reason,
          idempotencyKey: `wallet:admincredit:${reference}`,
          expenseSuffix: "GOODWILL",
          command: "adminCreditWallet",
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const { balance } = await this.ledger.getUserBalance(
      input.userId,
      currency,
    );
    return { credited: true as const, balance, currency };
  }

  /**
   * yakhsim rasman min mihfazat al-mustakhdim (USER:...:AVAILABLE) ila hisab
   * iyrad lil-minassa ('aks grantPromotionalCredit) 'abr idkhal muzdawaj
   * mutawazin dimna mu'amala qa'ima:
   *   DEBIT  mihfazat al-mustakhdim (LIABILITY)
   *   CREDIT iyrad al-minassa (PLATFORM:<revenueSuffix> - REVENUE)
   * yarfud al-rasid ghayr al-kafi (la yasmah bi-rasid salib) wa-huwa idempotent
   * 'abr idempotencyKey. idafi bi-l-kamil: la yughayyir ayya suluk mali qa'im.
   */
  async chargeWalletFee(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      amount: number;
      currency: string;
      revenueSuffix: string;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      idempotencyKey: string;
    },
  ): Promise<void> {
    this.ledger.assertCurrency(input.currency);
    if (!Number.isFinite(input.amount) || toMinorUnits(input.amount) <= 0) {
      throw new BadRequestException("Wallet fee must be positive");
    }
    // idempotency: in sabaqa tanfidh hadha al-qayd fa-la nukarrir al-khasm.
    const already = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (already) return;
    const userAcc = await this.ledger.userAccount(
      tx,
      input.userId,
      input.currency,
    );
    if (Number(userAcc.balanceCache) + 1e-9 < input.amount) {
      throw new AppException("SUBSCRIPTION_INSUFFICIENT_BALANCE");
    }
    const revenue = await this.ledger.platformAccount(
      tx,
      input.revenueSuffix,
      "REVENUE",
      input.currency,
    );
    await this.ledger.post(tx, {
      command: "chargeWalletFee",
      idempotencyKey: input.idempotencyKey,
      currency: input.currency,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      lines: [
        { accountId: userAcc.id, direction: "DEBIT", amount: input.amount },
        { accountId: revenue.id, direction: "CREDIT", amount: input.amount },
      ],
    });
  }

  /**
   * تحويل إكرامية من محفظة الراكب إلى محفظة السائق داخل معاملة قائمة.
   *
   *   DEBIT  محفظة الراكب (USER:...:AVAILABLE)
   *   CREDIT محفظة السائق (USER:...:AVAILABLE)
   *
   * بلا أي عمولة للمنصّة: الإكرامية تصل السائق كاملة كما في Uber وBolt.
   * يرفض الرصيد غير الكافي (لا يسمح برصيد سالب) وهو خامل التكرار عبر idempotencyKey.
   */
  async transferTip(
    tx: Prisma.TransactionClient,
    input: {
      fromUserId: string;
      toUserId: string;
      amount: number;
      currency: string;
      tripId: string;
      idempotencyKey: string;
    },
  ): Promise<void> {
    this.ledger.assertCurrency(input.currency);
    if (!Number.isFinite(input.amount) || toMinorUnits(input.amount) <= 0) {
      throw new BadRequestException("Tip must be positive");
    }
    if (input.fromUserId === input.toUserId) {
      throw new BadRequestException("Cannot tip yourself");
    }
    const already = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (already) return;
    const payer = await this.ledger.userAccount(
      tx,
      input.fromUserId,
      input.currency,
    );
    if (Number(payer.balanceCache) + 1e-9 < input.amount) {
      throw new BadRequestException("رصيد المحفظة غير كافٍ للإكرامية");
    }
    const driver = await this.ledger.userAccount(
      tx,
      input.toUserId,
      input.currency,
    );
    await this.ledger.post(tx, {
      command: "transferTip",
      idempotencyKey: input.idempotencyKey,
      currency: input.currency,
      referenceType: "TRIP_TIP",
      referenceId: input.tripId,
      reason: "driver_tip",
      lines: [
        { accountId: payer.id, direction: "DEBIT", amount: input.amount },
        { accountId: driver.id, direction: "CREDIT", amount: input.amount },
      ],
    });
  }

  async settleTrip(tripId: string): Promise<void> {
    return this.withTrace("financial.settle_trip", { tripId }, async () => {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const trip = await tx.trip.findUnique({
              where: { id: tripId },
              include: {
                driver: { select: { userId: true } },
                city: { select: { country: true } },
              },
            });
            if (
              !trip ||
              trip.status !== "COMPLETED" ||
              !trip.driver ||
              trip.fare == null
            )
              throw new AppException("SETTLEMENT_NOT_ELIGIBLE", {
                details: { tripId },
              });
            const currentSettlement = (trip.settlementStatus ??
              "PENDING") as SettlementStatus;
            if (!canSettlementTransition(currentSettlement, "POSTED")) {
              // التسوية مُرحّلة بالفعل أو غير مؤهّلة — لا شيء لتنفيذه (idempotent).
              return;
            }
            const countryCode = trip.city?.country?.trim().toUpperCase();
            if (countryCode && this.countryConfig) {
              const expectedCurrency =
                await this.countryConfig.currencyFor(countryCode);
              if (expectedCurrency !== trip.currency) {
                throw new AppException("CURRENCY_COUNTRY_MISMATCH", {
                  details: { tripId, countryCode, currency: trip.currency },
                });
              }
            }
            // trip.fare هي ما يدفعه الراكب فعليًا (الكوبون طُبّق وقت الطلب)، ولا
            // نطبّق الخصم ثانيةً هنا. العمولة تُحتسب على قيمة الرحلة **قبل**
            // الخصم، فيبقى صافي السائق كرحلة بلا كوبون، وما تتحمّله المنصّة من
            // الخصم يُمنح للسائق كرصيد عمولة مخصّص (لا نقدًا ولا ربحًا) —
            // انظر القيد الثالث أدناه.
            const discount = Math.max(Number(trip.discountAmount ?? 0), 0);
            // المرحلة 7 — مصدر حقيقة واحد للأجرة:
            // زمن الانتظار يُشتق من طوابع الخادم فقط (حدث status:ARRIVING
            // الذي يكتبه changeStatus ثم trip.startedAt)، ولا يصل أي رقم
            // انتظار من تطبيق السائق أو الراكب.
            const arrival = await tx.tripEvent.findFirst({
              where: { tripId, type: ARRIVAL_EVENT_TYPE },
              orderBy: { createdAt: "asc" },
              select: { createdAt: true },
            });
            const waitingSeconds = computeWaitingSeconds(
              arrival?.createdAt,
              trip.startedAt,
            );
            const waitingPolicy = waitingPolicyFrom(
              await this.loadPricingFees(),
            );
            // إعادة تركيب الأجرة بنفس الدالة التي يستعملها محرك التسعير
            // (buildFareBreakdown) بدل حساب يدوي موازٍ: الأساس هو ما رآه الراكب
            // وقت الطلب (شامل الأساس والمسافة والمدة والحد الأدنى ورسوم
            // الخدمة والضريبة) قبل خصم الكوبون، ويُضاف إليه رسم الانتظار
            // المحتسب خادميًا إن كانت سياسة اللوحة مفعّلة.
            const breakdown = buildFareBreakdown({
              baseComputedFare: round2(Number(trip.fare) + discount),
              commissionPct: trip.commissionPct,
              waitingSeconds,
              waitingPolicy,
              coupon:
                discount > 0
                  ? {
                      kind: "FIXED",
                      value: discount,
                      funding: (trip.couponFundingSource ??
                        "PLATFORM") as CouponFundingSource,
                      platformShare:
                        trip.couponPlatformShare != null
                          ? Number(trip.couponPlatformShare)
                          : undefined,
                    }
                  : null,
            });
            const waitingCharge = breakdown.components.waitingCharge;
            const riderPays = breakdown.riderPays;
            if (waitingCharge > 0) {
              // تثبيت المبلغ النهائي على الرحلة حتى لا يختلف ما يراه الراكب
              // في الفاتورة عمّا دخل دفتر الأستاذ.
              await tx.trip.update({
                where: { id: tripId },
                data: { fare: new Prisma.Decimal(riderPays) },
              });
              await tx.tripEvent.create({
                data: {
                  tripId,
                  type: "fare:waiting_applied",
                  actor: "SYSTEM",
                  meta: { waitingSeconds, waitingCharge, riderPays },
                },
              });
            }
            // ===================================================================
            // نموذج flaminGO المالي — ثلاثة أرصدة منفصلة لا تختلط:
            //
            //   USER:<driver>:AVAILABLE          محفظة عمولة السائق
            //                                   (رصيد تشغيلي مسبق الدفع،
            //                                    ليس ربحًا وغير قابل للسحب)
            //   USER:<driver>:COMMISSION_CREDIT  رصيد عمولة الكوبون
            //                                   (يُستهلك في عمولة رحلات لاحقة)
            //   PLATFORM:DRIVER_PAYABLE          صافي أرباح السائق المستحقّ
            //                                   عن الرحلات المدفوعة إلكترونيًا
            //   PLATFORM:COMMISSION              استحقاق عمولة المنصّة
            //
            // ولذلك:
            //   • الرحلة **النقدية**: المنصّة لا تلمس المال — الراكب يدفع
            //     للسائق مباشرة. القيد الوحيد هو تحصيل العمولة من محفظة
            //     العمولة. لا يُضاف أي رصيد للسائق، فيستحيل الائتمان
            //     الاقتصادي المزدوج (نقد في يده + رصيد قابل للسحب).
            //   • الرحلة بـ**flaminGO Pay / بطاقة**: المنصّة تُحصّل المبلغ،
            //     تحتجز العمولة منه، والباقي يُقيَّد كمستحقّ للسائق.
            //
            // سياسة تمويل الكوبون تُقرّر وقت الطلب وتُخزّن على الرحلة وتُدار
            // بالكامل من لوحة التحكم (إعداد عام coupons.funding + تجاوز لكل
            // كوبون): PLATFORM/DRIVER/SHARED. حصة السائق من التمويل محسومة
            // أصلًا داخل breakdown.driverNet، وحصة المنصّة تُمنح للسائق
            // كـ**رصيد عمولة** لا كنقد (انظر القيد الثالث أدناه).
            const driverNet = breakdown.driverNet;
            const commissionDue = breakdown.commission;
            const couponCommissionCredit = breakdown.coupon.platformFunded;

            const driverWallet = await this.ledger.userAccount(
              tx,
              trip.driver.userId,
              trip.currency,
            );
            const commissionCreditAccount =
              await this.ledger.commissionCreditAccount(
                tx,
                trip.driver.userId,
                trip.currency,
              );
            const revenue = await this.ledger.platformAccount(
              tx,
              "COMMISSION",
              "REVENUE",
              trip.currency,
            );
            const driverPayable = await this.ledger.platformAccount(
              tx,
              "DRIVER_PAYABLE",
              "LIABILITY",
              trip.currency,
            );

            // ---------- القيد 1: تحصيل الأجرة (إلكترونيًا فقط) ----------
            // الرحلة النقدية لا تُنتج قيد تحصيل إطلاقًا: لا يوجد مال عبر
            // المنصّة كي يُقيَّد، وإنشاء قيد صوري له كان سيعني تضخيم إيراد
            // لم يُحصَّل. هذا هو الفرق الجوهري الذي يمنع الائتمان المزدوج.
            const isElectronic =
              trip.paymentMethod === "WALLET" || trip.paymentMethod === "CARD";
            const collected = isElectronic ? riderPays : 0;

            if (collected > 0) {
              const source =
                trip.paymentMethod === "WALLET"
                  ? await this.ledger.userAccount(
                      tx,
                      trip.passengerId,
                      trip.currency,
                    )
                  : await this.ledger.platformAccount(
                      tx,
                      "CARD_RECEIVABLE",
                      "ASSET",
                      trip.currency,
                    );
              // رصيد flaminGO Pay للراكب حساب حقيقي لا حساب مقاصّة: خصم
              // يتجاوزه يتركه سالبًا بلا غطاء. الفحص وقت الـcheckout لا يكفي
              // لأن الرصيد قد ينخفض بين إنشاء الدفعة والتسوية (اشتراك،
              // إكرامية، رحلة أخرى). نرفض هنا فتُوسَم الرحلة FAILED ويعيد
              // retryUnsettledTrips المحاولة بدل إنشاء رصيد سالب صامت.
              if (
                trip.paymentMethod === "WALLET" &&
                Number(source.balanceCache) + 1e-9 < collected
              ) {
                throw new AppException("INSUFFICIENT_BALANCE", {
                  details: {
                    tripId,
                    required: collected,
                    balance: Number(source.balanceCache),
                    currency: trip.currency,
                  },
                });
              }
              await this.ledger.post(tx, {
                command: "settleTrip",
                idempotencyKey: `trip:settle:${tripId}`,
                currency: trip.currency,
                referenceType: "TRIP",
                referenceId: tripId,
                reason: "trip_fare_collected",
                lines: [
                  { accountId: source.id, direction: "DEBIT", amount: collected },
                  {
                    accountId: driverPayable.id,
                    direction: "CREDIT",
                    amount: collected,
                  },
                ],
              });
            }

            // ---------- القيد 2: عمولة المنصّة ----------
            // الترتيب (رصيد الكوبون ← المُحصَّل ← محفظة العمولة) دالة نقية
            // مشتركة مع فحص ما قبل القبول، فلا يختلف شرط القبول عن الخصم.
            //
            // مهم: رصيد الكوبون يُقرأ **قبل** منح رصيد هذه الرحلة (القيد 3)،
            // فمنفعة كوبون الرحلة الحالية لا تُستهلك في عمولتها هي — بل في
            // عمولة رحلة لاحقة، كما ينصّ نموذج العمل.
            const creditAvailable = Number(
              commissionCreditAccount.balanceCache,
            );
            const funding = planCommissionFunding({
              commissionDue,
              commissionCreditAvailable: creditAvailable,
              electronicallyCollected: collected,
            });

            if (
              funding.fromDriverWallet > 0 &&
              Number(driverWallet.balanceCache) + 1e-9 <
                funding.fromDriverWallet
            ) {
              // لا نسمح برصيد سالب في محفظة العمولة. الرحلة تُوسَم FAILED
              // وتظهر في طابور التسوية وتُعاد المحاولة بعد الشحن.
              throw new AppException("DRIVER_COMMISSION_BALANCE_INSUFFICIENT", {
                details: {
                  tripId,
                  driverId: trip.driverId,
                  required: funding.fromDriverWallet,
                  walletBalance: Number(driverWallet.balanceCache),
                  commissionCredit: creditAvailable,
                  currency: trip.currency,
                },
              });
            }

            if (commissionDue > 0) {
              const commissionLines: PostingLine[] = [];
              if (funding.fromCommissionCredit > 0) {
                commissionLines.push({
                  accountId: commissionCreditAccount.id,
                  direction: "DEBIT",
                  amount: funding.fromCommissionCredit,
                });
              }
              if (funding.fromCollection > 0) {
                commissionLines.push({
                  accountId: driverPayable.id,
                  direction: "DEBIT",
                  amount: funding.fromCollection,
                });
              }
              if (funding.fromDriverWallet > 0) {
                commissionLines.push({
                  accountId: driverWallet.id,
                  direction: "DEBIT",
                  amount: funding.fromDriverWallet,
                });
              }
              commissionLines.push({
                accountId: revenue.id,
                direction: "CREDIT",
                amount: commissionDue,
              });
              await this.ledger.post(tx, {
                command: "settleTripCommission",
                idempotencyKey: `trip:commission:${tripId}`,
                currency: trip.currency,
                referenceType: "TRIP",
                referenceId: tripId,
                reason: "platform_commission",
                lines: commissionLines,
              });
            }

            // ---------- القيد 3: رصيد عمولة الكوبون ----------
            // ما تحمّلته المنصّة من خصم الكوبون يُمنح للسائق كرصيد عمولة
            // مخصّص (لا نقدًا ولا ربحًا ولا رصيدًا قابلًا للسحب أو التحويل)،
            // مقابل مصروف دعم ترويجي على المنصّة.
            if (couponCommissionCredit > 0) {
              const subsidy = await this.ledger.platformAccount(
                tx,
                "COUPON_SUBSIDY",
                "EXPENSE",
                trip.currency,
              );
              await this.ledger.post(tx, {
                command: "grantCouponCommissionCredit",
                idempotencyKey: `trip:couponcredit:${tripId}`,
                currency: trip.currency,
                referenceType: "TRIP",
                referenceId: tripId,
                reason: "coupon_commission_credit",
                lines: [
                  {
                    accountId: subsidy.id,
                    direction: "DEBIT",
                    amount: couponCommissionCredit,
                  },
                  {
                    accountId: commissionCreditAccount.id,
                    direction: "CREDIT",
                    amount: couponCommissionCredit,
                  },
                ],
              });
            }

            // ---------- تحصيل غرامات إلغاء السائق المتراكمة ----------
            // تُحصّل من محفظة العمولة (الرصيد التشغيلي الوحيد للسائق)،
            // ومقيدة بما بقي فيها فعلًا بعد خصم عمولة هذه الرحلة فلا
            // يصبح الرصيد سالبًا.
            if (trip.driverId) {
              const walletAfterCommission = round2(
                Number(driverWallet.balanceCache) - funding.fromDriverWallet,
              );
              await this.recoverDriverCancellationPenalties(tx, {
                settledTripId: tripId,
                driverId: trip.driverId,
                driverAccountId: driverWallet.id,
                currency: trip.currency,
                maxRecoverable: Math.max(walletAfterCommission, 0),
              });
            }

            await tx.payment.upsert({
              where: { tripId },
              create: {
                tripId,
                userId: trip.passengerId,
                amount: riderPays,
                method: trip.paymentMethod,
                status: trip.paymentMethod === "CARD" ? "PENDING" : "PAID",
              },
              update: {},
            });

            // إسقاط الأرباح (DriverEarning/CompanyEarning) يُكتب من نفس
            // التفكيك الذي وُلّدت منه القيود، داخل المعاملة نفسها. هذه قيم
            // **محاسبية/عرضية** لا أرصدة قابلة للسحب:
            //   gross      = قيمة الرحلة قبل الخصم
            //   commission = استحقاق عمولة المنصّة (اللقطة التاريخية)
            //   net        = صافي أرباح السائق
            // لأنها مشتقّة من لقطة الرحلة (fare + commissionPct + سياسة
            // الكوبون) فإن تغيير إعداد العمولة في اللوحة لاحقًا لا يعيد
            // كتابتها إطلاقًا.
            const gross = breakdown.grossFare;
            const commission = commissionDue;
            const net = driverNet;
            await this.projectTripEarnings(tx, {
              tripId,
              driverId: trip.driverId as string,
              gross,
              commission,
              net,
            });
            await tx.trip.update({
              where: { id: tripId },
              data: {
                settledAt: new Date(),
                settlementError: null,
                settlementStatus: "POSTED",
                settlementAttempts: { increment: 1 },
              },
            });
            await tx.tripEvent.create({
              data: {
                tripId,
                type: "settlement:posted",
                actor: "SYSTEM",
                meta: {
                  gross,
                  net,
                  commission,
                  commissionPct: trip.commissionPct,
                  commissionRuleId: trip.commissionRuleId,
                  paymentMethod: trip.paymentMethod,
                  riderPays,
                  electronicallyCollected: collected,
                  commissionFromCredit: funding.fromCommissionCredit,
                  commissionFromCollection: funding.fromCollection,
                  commissionFromWallet: funding.fromDriverWallet,
                  couponCommissionCredit,
                },
              },
            });
            // حدث دائم داخل نفس المعاملة (transactional outbox) — يُسلّم لاحقًا مع إعادة محاولة + DLQ.
            await this.outbox.enqueue(
              tx,
              "trip.settled",
              { tripId, gross, net, commission, currency: trip.currency },
              { dedupeKey: `trip:settled:${tripId}` },
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        await this.prisma.trip.updateMany({
          where: { id: tripId, settledAt: null },
          data: {
            settlementAttempts: { increment: 1 },
            settlementStatus: "FAILED",
            settlementError:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Unknown settlement error",
          },
        });
        await this.prisma.tripEvent
          .create({
            data: {
              tripId,
              type: "settlement:failed",
              actor: "SYSTEM",
              meta: {
                error:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : "Unknown settlement error",
              },
            },
          })
          .catch(() => undefined);
        throw error;
      }
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryUnsettledTrips(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.lock.runExclusive(
      "cron:financial-retry-trips",
      () => this.retryUnsettledTripsTask(),
      55000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async retryUnsettledTripsTask(): Promise<void> {
    const trips = await this.prisma.trip.findMany({
      where: {
        status: "COMPLETED",
        settledAt: null,
        settlementAttempts: { lt: 20 },
      },
      select: { id: true },
      orderBy: { completedAt: "asc" },
      take: 100,
    });
    for (const trip of trips) {
      try {
        await this.settleTrip(trip.id);
      } catch (error) {
        this.logger.warn(
          `Settlement retry failed for ${trip.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * غرامة إلغاء السائق — السياسة الوحيدة المعتمدة (إغلاق المرحلة 10):
   *
   *   - الغرامة على السائق فقط؛ لا توجد أي غرامة مالية على الراكب إطلاقًا.
   *   - **لا خصم مباشر من محفظة السائق**: تُقيد الغرامة كمستحقّ (أصل):
   *       DEBIT  PLATFORM:DRIVER_PENALTY_RECEIVABLE
   *       CREDIT PLATFORM:DRIVER_CANCELLATION_PENALTY
   *     ثم تُحصّل من مستحقّ السائق عند تسوية أول رحلة مكتملة داخل
   *     settleTrip() عبر recoverDriverCancellationPenalties — مصدر حقيقة واحد
   *     للتسوية، ومقيد بالمبلغ المتاح فلا يصبح الرصيد سالبًا.
   *   - لا غرامة إذا ألغى السائق قبل قبول الرحلة (acceptedAt = null).
   *   - النسبة مضبوطة من لوحة التحكم (trips.driverCancellationPenaltyPct).
   *   - قيد مزدوج متوازن + idempotent (trip:drvcancelpen:<tripId>) فلا تُحسب مرتين.
   */
  async settleDriverCancellationPenalty(tripId: string): Promise<void> {
    return this.withTrace(
      "financial.settle_driver_cancellation_penalty",
      { tripId },
      async () => {
        try {
          await this.prisma.$transaction(
            async (tx) => {
              const trip = await tx.trip.findUnique({
                where: { id: tripId },
                include: { driver: { select: { userId: true } } },
              });
              if (
                !trip ||
                trip.status !== "CANCELLED" ||
                trip.cancelledBy !== "DRIVER" ||
                !trip.driver ||
                trip.fare == null ||
                Number(trip.fare) <= 0
              ) {
                // ليست رحلة ألغاها السائق أو بلا قيمة — لا غرامة (idempotent).
                return;
              }
              if (trip.cancellationSettledAt) return; // عولجت سابقًا.
              // قرار معتمد: لا غرامة إن ألغى السائق قبل قبول الرحلة.
              if (!trip.acceptedAt) {
                await tx.trip.update({
                  where: { id: tripId },
                  data: {
                    cancellationSettledAt: new Date(),
                    cancellationSettlementError: null,
                    cancellationSettlementAttempts: { increment: 1 },
                  },
                });
                await tx.tripEvent.create({
                  data: {
                    tripId,
                    type: "driver_cancel_penalty:before_accept",
                    actor: "SYSTEM",
                    meta: { policy: "NO_PENALTY_BEFORE_ACCEPT" },
                  },
                });
                return;
              }
              const pct = await this.loadDriverCancellationPenaltyPct();
              const penalty = round2((Number(trip.fare) * pct) / 100);
              const currency = trip.currency;
              if (penalty <= 0) {
                // النسبة صفر (الميزة غير مفعّلة من اللوحة) — علّمها كمعالَجة بلا حسم.
                await tx.trip.update({
                  where: { id: tripId },
                  data: {
                    cancellationSettledAt: new Date(),
                    cancellationSettlementError: null,
                    cancellationSettlementAttempts: { increment: 1 },
                  },
                });
                await tx.tripEvent.create({
                  data: {
                    tripId,
                    type: "driver_cancel_penalty:none",
                    actor: "SYSTEM",
                    meta: { pct, fare: Number(trip.fare) },
                  },
                });
                return;
              }
              // استحقاق لا خصم: أصل (مستحقّ على السائق) مقابل إيراد المنصة.
              // محفظة السائق لا تُمسّ هنا إطلاقًا.
              const receivable = await this.ledger.platformAccount(
                tx,
                "DRIVER_PENALTY_RECEIVABLE",
                "ASSET",
                currency,
              );
              const revenue = await this.ledger.platformAccount(
                tx,
                "DRIVER_CANCELLATION_PENALTY",
                "REVENUE",
                currency,
              );
              await this.ledger.post(tx, {
                command: "settleDriverCancellationPenalty",
                idempotencyKey: `trip:drvcancelpen:${tripId}`,
                currency,
                referenceType: "TRIP",
                referenceId: tripId,
                reason:
                  "Driver cancellation penalty (accrued, recovered at settlement)",
                lines: [
                  {
                    accountId: receivable.id,
                    direction: "DEBIT",
                    amount: penalty,
                  },
                  {
                    accountId: revenue.id,
                    direction: "CREDIT",
                    amount: penalty,
                  },
                ],
              });
              await tx.trip.update({
                where: { id: tripId },
                data: {
                  cancellationFee: penalty,
                  cancellationSettledAt: new Date(),
                  cancellationSettlementError: null,
                  cancellationSettlementAttempts: { increment: 1 },
                },
              });
              await tx.tripEvent.create({
                data: {
                  tripId,
                  type: "driver_cancel_penalty:accrued",
                  actor: "SYSTEM",
                  meta: {
                    penalty,
                    pct,
                    fare: Number(trip.fare),
                    walletDebited: false,
                    recovery: "next_trip_settlement",
                  },
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          await this.prisma.trip
            .updateMany({
              where: { id: tripId, cancellationSettledAt: null },
              data: {
                cancellationSettlementAttempts: { increment: 1 },
                cancellationSettlementError:
                  error instanceof Error
                    ? error.message.slice(0, 500)
                    : "Unknown driver cancellation penalty error",
              },
            })
            .catch(() => undefined);
          this.logger.warn(
            `Driver cancellation penalty failed for ${tripId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
      },
    );
  }

  /**
   * سياسة رسوم الأجرة (pricing.fees) من جدول الإعدادات الذي تديره اللوحة.
   *
   * تُقرأ مباشرةً من صف Setting وتُطبّع بنفس الدالة النقية التي يستعملها
   * محرك التسعير (normalizePricingFees)، فلا يوجد منطق تطبيع مكرر ولا
   * اعتماد دائري بين الوحدة المالية ووحدة التسعير.
   */
  private async loadPricingFees(): Promise<PricingFeesSetting> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: PRICING_FEES_SETTING_KEY },
      });
      const raw = (setting?.publishedValue ?? setting?.value) as
        | Partial<PricingFeesSetting>
        | null;
      return normalizePricingFees(raw);
    } catch {
      return DEFAULT_PRICING_FEES;
    }
  }

  /**
   * D-4 — إلغاء الراكب: **لا توجد أي غرامة مالية إطلاقًا** (قرار نهائي معتمد).
   *
   *   - لا خصم من محفظة الراكب، ولا قيد دفتر أستاذ، ولا رصيد سالب.
   *   - بدل الغرامة: نظام تحذير/مخاطر وتجميد في
   *     PassengerCancellationRiskService (RiskEvent + RiskHold + AuditLog).
   *   - تُبقى الدالة لأن settleCancellationFinancials والـcron يناديانها،
   *     لكن أصبح أثرها وسم الرحلة كمُعالجة وتصفير cancellationFee فقط،
   *     وتسجيل TripEvent للشفافية (passenger_cancel:no_fee).
   *   - محتفظ بالـidempotency عبر cancellationSettledAt.
   *
   * ملاحظة: الوصف القديم (الخصم من المحفظة وجواز الرصيد السالب حتى أول
   * شحن) ملغٍ نهائيًا ولا يجوز إعادته.
   */
  async settlePassengerCancellationFee(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        cancelledBy: true,
        cancellationSettledAt: true,
        cancellationFee: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.status !== "CANCELLED") return;
    if (trip.cancelledBy !== "PASSENGER") return;
    if (trip.cancellationSettledAt) return; // مُعالجة سابقًا — idempotent.

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.trip.findUnique({
        where: { id: tripId },
        select: { cancellationSettledAt: true },
      });
      if (!fresh || fresh.cancellationSettledAt) return;
      await tx.trip.update({
        where: { id: tripId },
        data: {
          cancellationFee: null,
          cancellationSettledAt: new Date(),
          cancellationSettlementError: null,
          cancellationSettlementAttempts: { increment: 1 },
        },
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "passenger_cancel:no_fee",
          actor: "SYSTEM",
          meta: {
            policy: "PASSENGER_CANCELLATION_FEE_ABOLISHED",
            chargedAmount: 0,
            walletDebited: false,
          },
        },
      });
    });
  }

  /**
   * تحصيل غرامات إلغاء السائق المتراكمة وقت تسوية رحلة مكتملة.
   *
   * يُنادى داخل معاملة settleTrip() نفسها بعد قيد العمولة:
   *   DEBIT  محفظة عمولة السائق (USER:...:AVAILABLE)
   *   CREDIT PLATFORM:DRIVER_PENALTY_RECEIVABLE (إقفال المستحقّ)
   *
   * لماذا من محفظة العمولة: بعد تصحيح النموذج لم يبقَ للسائق أي رصيد آخر
   * لدى المنصّة إلا هذه المحفظة (صافي أرباحه صار مستحقًّا على المنصّة في
   * PLATFORM:DRIVER_PAYABLE، ورصيد الكوبون مخصّص للعمولة حصرًا).
   *
   * ضمانات:
   *   - مقيد بـ maxRecoverable (= ما بقي في المحفظة بعد خصم عمولة هذه
   *     الرحلة) فلا يصبح الرصيد سالبًا أبدًا.
   *   - idempotent مرتين: مفتاح trip:drvpenrecover:<penaltyTrip>:<settledTrip>
   *     يمنع تكرار نفس التسوية، وفحص referenceId يمنع تحصيل نفس
   *     الغرامة مرة أخرى في تسوية لاحقة.
   *   - قيد منفصل عن قيد العمولة قصدًا حتى لا تختلط الغرامة بالعمولة في
   *     أي تقرير أو إعادة بناء.
   */
  private async recoverDriverCancellationPenalties(
    tx: Prisma.TransactionClient,
    input: {
      settledTripId: string;
      driverId: string;
      driverAccountId: string;
      currency: string;
      maxRecoverable: number;
    },
  ): Promise<number> {
    let remaining = round2(input.maxRecoverable);
    if (remaining <= 0) return 0;

    const pendingPenalties = await tx.trip.findMany({
      where: {
        driverId: input.driverId,
        status: "CANCELLED",
        cancelledBy: "DRIVER",
        currency: input.currency,
        cancellationFee: { gt: 0 },
        id: { not: input.settledTripId },
      },
      select: { id: true, cancellationFee: true },
      orderBy: { cancellationSettledAt: "asc" },
      take: 20,
    });
    if (pendingPenalties.length === 0) return 0;

    const receivable = await this.ledger.platformAccount(
      tx,
      "DRIVER_PENALTY_RECEIVABLE",
      "ASSET",
      input.currency,
    );

    let collectedTotal = 0;
    for (const penalty of pendingPenalties) {
      if (remaining <= 0) break;
      // هل حُصّلت هذه الغرامة من قبل (في أي تسوية)؟
      const already = await tx.ledgerTransaction.findFirst({
        where: {
          command: "recoverDriverCancellationPenalty",
          referenceType: "TRIP",
          referenceId: penalty.id,
        },
        select: { id: true },
      });
      if (already) continue;

      const amount = round2(
        Math.min(Number(penalty.cancellationFee), remaining),
      );
      if (amount <= 0) continue;

      await this.ledger.post(tx, {
        command: "recoverDriverCancellationPenalty",
        idempotencyKey: `trip:drvpenrecover:${penalty.id}:${input.settledTripId}`,
        currency: input.currency,
        referenceType: "TRIP",
        referenceId: penalty.id,
        reason: `Driver cancellation penalty recovered from settlement of trip ${input.settledTripId}`,
        lines: [
          {
            accountId: input.driverAccountId,
            direction: "DEBIT",
            amount,
          },
          {
            accountId: receivable.id,
            direction: "CREDIT",
            amount,
          },
        ],
      });

      await tx.tripEvent.create({
        data: {
          tripId: penalty.id,
          type: "driver_cancel_penalty:collected",
          actor: "SYSTEM",
          meta: {
            amount,
            settledTripId: input.settledTripId,
            fromWallet: false,
            source: "driver_settlement",
          },
        },
      });
      await tx.tripEvent.create({
        data: {
          tripId: input.settledTripId,
          type: "settlement:driver_penalty_deducted",
          actor: "SYSTEM",
          meta: { amount, penaltyTripId: penalty.id },
        },
      });

      remaining = round2(remaining - amount);
      collectedTotal = round2(collectedTotal + amount);
    }
    return collectedTotal;
  }

  /** نسبة غرامة إلغاء السائق (0..100) من الإعدادات (قابلة للضبط من اللوحة)، افتراضيًا 0. */
  private async loadDriverCancellationPenaltyPct(): Promise<number> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: DRIVER_CANCELLATION_PENALTY_KEY },
      });
      const raw = (setting?.publishedValue ?? setting?.value) as unknown as {
        pct?: unknown;
      } | null;
      let pct = Number(raw?.pct);
      if (!Number.isFinite(pct)) pct = DEFAULT_DRIVER_CANCELLATION_PENALTY_PCT;
      return Math.min(100, Math.max(0, pct));
    } catch {
      return DEFAULT_DRIVER_CANCELLATION_PENALTY_PCT;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryUnsettledDriverCancellationPenalties(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.lock.runExclusive(
      "cron:financial-retry-penalties",
      () => this.retryUnsettledDriverCancellationPenaltiesTask(),
      55000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async retryUnsettledDriverCancellationPenaltiesTask(): Promise<void> {
    const trips = await this.prisma.trip.findMany({
      where: {
        status: "CANCELLED",
        cancelledBy: "DRIVER",
        cancellationSettledAt: null,
        fare: { gt: 0 },
        cancellationSettlementAttempts: { lt: 20 },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    for (const trip of trips) {
      try {
        await this.settleDriverCancellationPenalty(trip.id);
      } catch (error) {
        this.logger.warn(
          `Driver cancellation penalty retry failed for ${trip.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // المرحلة 7: نفس شبكة الأمان لإلغاءات الراكب — إن فشل حسم رسم الإلغاء
    // لحظة الإلغاء (تعارض أو انقطاع) تُعاد المحاولة هنا بدل أن يضيع الرسم صامتًا.
    // لا شرط fare > 0 هنا لأن رسم الإلغاء مستقل عن قيمة الرحلة.
    const cancelledByPassenger = await this.prisma.trip.findMany({
      where: {
        status: "CANCELLED",
        cancelledBy: "PASSENGER",
        cancellationSettledAt: null,
        cancellationSettlementAttempts: { lt: 20 },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    for (const trip of cancelledByPassenger) {
      try {
        await this.settlePassengerCancellationFee(trip.id);
      } catch (error) {
        this.logger.warn(
          `Passenger cancellation fee retry failed for ${trip.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async reserveWithdrawal(withdrawalId: string): Promise<void> {
    return this.withTrace(
      "financial.reserve_withdrawal",
      { withdrawalId },
      async () => {
        // قفل موزّع لكل مستخدم يمنع تسابق طلبات السحب المتزامنة (TOCTOU على الرصيد) عبر عدة نسخ.
        const pre = await this.prisma.withdrawRequest.findUnique({
          where: { id: withdrawalId },
          select: { userId: true },
        });
        if (!pre) {
          throw new AppException("WITHDRAWAL_NOT_FOUND", {
            details: { withdrawalId },
          });
        }
        await this.lock.withLock(`withdraw:user:${pre.userId}`, async () => {
          await this.prisma.$transaction(
            async (tx) => {
              const request = await tx.withdrawRequest.findUnique({
                where: { id: withdrawalId },
              });
              if (!request) {
                throw new AppException("WITHDRAWAL_NOT_FOUND", {
                  details: { withdrawalId },
                });
              }
              const user = await this.ledger.userAccount(
                tx,
                request.userId,
                DEFAULT_CURRENCY,
              );
              if (Number(user.balanceCache) < Number(request.amount))
                throw new AppException("INSUFFICIENT_BALANCE", {
                  details: { withdrawalId, userId: request.userId },
                });
              const reserve = await this.ledger.platformAccount(
                tx,
                "WITHDRAWAL_RESERVE",
                "LIABILITY",
                DEFAULT_CURRENCY,
              );
              await this.ledger.post(tx, {
                command: "reserveWithdrawal",
                idempotencyKey: `withdrawal:reserve:${withdrawalId}`,
                currency: DEFAULT_CURRENCY,
                referenceType: "WITHDRAWAL",
                referenceId: withdrawalId,
                lines: [
                  {
                    accountId: user.id,
                    direction: "DEBIT",
                    amount: Number(request.amount),
                  },
                  {
                    accountId: reserve.id,
                    direction: "CREDIT",
                    amount: Number(request.amount),
                  },
                ],
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        });
      },
    );
  }

  async releaseWithdrawal(id: string): Promise<void> {
    const original = await this.ledger.byKey(`withdrawal:reserve:${id}`);
    await this.ledger.reverseTransaction(
      original.id,
      `withdrawal:release:${id}`,
      "releaseWithdrawal",
    );
  }
  async captureCardPayment(paymentId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          include: { trip: true },
        });
        if (!payment || payment.method !== "CARD")
          throw new NotFoundException("Card payment not found");
        if (!payment.trip || !payment.trip.settledAt) return;
        const cash = await this.ledger.platformAccount(
          tx,
          "CASH",
          "ASSET",
          payment.trip.currency,
        );
        const receivable = await this.ledger.platformAccount(
          tx,
          "CARD_RECEIVABLE",
          "ASSET",
          payment.trip.currency,
        );
        await this.ledger.post(tx, {
          command: "captureCardPayment",
          idempotencyKey: `payment:capture:${paymentId}`,
          currency: payment.trip.currency,
          referenceType: "PAYMENT",
          referenceId: paymentId,
          lines: [
            {
              accountId: cash.id,
              direction: "DEBIT",
              amount: Number(payment.amount),
            },
            {
              accountId: receivable.id,
              direction: "CREDIT",
              amount: Number(payment.amount),
            },
          ],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async refundPayment(id: string): Promise<void> {
    const original = await this.prisma.ledgerTransaction.findFirst({
      where: { referenceType: "PAYMENT", referenceId: id, status: "POSTED" },
      orderBy: { createdAt: "desc" },
    });
    if (!original) {
      this.logger.warn(
        `No posted payment ledger transaction found for refund ${id}`,
      );
      return;
    }
    await this.ledger.reverseTransaction(
      original.id,
      `payment:refund:${id}`,
      "refundPayment",
    );
  }
  async completeWithdrawal(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException("Withdrawal not found");
      const reserve = await this.ledger.platformAccount(
        tx,
        "WITHDRAWAL_RESERVE",
        "LIABILITY",
        DEFAULT_CURRENCY,
      );
      const cash = await this.ledger.platformAccount(
        tx,
        "CASH",
        "ASSET",
        DEFAULT_CURRENCY,
      );
      await this.ledger.post(tx, {
        command: "completeWithdrawal",
        idempotencyKey: `withdrawal:complete:${id}`,
        currency: DEFAULT_CURRENCY,
        referenceType: "WITHDRAWAL",
        referenceId: id,
        lines: [
          {
            accountId: reserve.id,
            direction: "DEBIT",
            amount: Number(request.amount),
          },
          {
            accountId: cash.id,
            direction: "CREDIT",
            amount: Number(request.amount),
          },
        ],
      });
    });
  }
  /**
   * شحن محفظة **عمولة** السائق بواسطة الطاقم/الوكيل (طلب مُعتمد).
   *
   * المحفظة رصيد تشغيلي مسبق الدفع لتغطية عمولة المنصّة، وليست محفظة
   * أرباح: الشحن هنا لا يُنشئ ربحًا للسائق ولا مبلغًا قابلًا للسحب.
   *   DEBIT  PLATFORM:CASH (ASSET) — نقد استلمه الوكيل فعلًا
   *   CREDIT USER:<driver>:AVAILABLE (LIABILITY)
   * خامل التكرار عبر `driverFunding:fund:<requestId>`.
   */
  async fundDriverWallet(requestId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.driverFundingRequest.findUnique({
          where: { id: requestId },
          include: { driver: { select: { userId: true } } },
        });
        if (!request)
          throw new NotFoundException("Driver funding request not found");
        if (request.status === "FUNDED") return;
        if (request.status !== "APPROVED") {
          throw new BadRequestException(
            "Driver funding request must be approved first",
          );
        }
        const user = await this.ledger.userAccount(
          tx,
          request.driver.userId,
          DEFAULT_CURRENCY,
        );
        const cash = await this.ledger.platformAccount(
          tx,
          "CASH",
          "ASSET",
          DEFAULT_CURRENCY,
        );
        await this.ledger.post(tx, {
          command: "fundDriverWallet",
          idempotencyKey: `driverFunding:fund:${requestId}`,
          currency: DEFAULT_CURRENCY,
          referenceType: "DRIVER_FUNDING",
          referenceId: requestId,
          lines: [
            {
              accountId: cash.id,
              direction: "DEBIT",
              amount: Number(request.amount),
            },
            {
              accountId: user.id,
              direction: "CREDIT",
              amount: Number(request.amount),
            },
          ],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  /**
   * تحويل رصيد محفظة العمولة بين سائقين (طلب مُعتمد من الطاقم).
   *
   * تحويل **داخلي** فقط ولا علاقة له بالسحب: الرصيد ينتقل من محفظة عمولة
   * إلى محفظة عمولة ولا يخرج من المنصّة إطلاقًا. مقيّد برصيد المُرسِل
   * فلا يصبح سالبًا، وخامل التكرار عبر
   * `driverTransfer:complete:<transferId>`، وكله داخل معاملة واحدة بعزل
   * Serializable فلا يمكن لتحويلين متزامنين صرف نفس الرصيد.
   */
  async transferDriverFunds(transferId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const transfer = await tx.driverTransfer.findUnique({
          where: { id: transferId },
          include: {
            fromDriver: { select: { userId: true } },
            toDriver: { select: { userId: true } },
          },
        });
        if (!transfer) throw new NotFoundException("Driver transfer not found");
        if (transfer.status === "COMPLETED") return;
        if (transfer.status !== "APPROVED") {
          throw new BadRequestException(
            "Driver transfer must be approved first",
          );
        }
        const sender = await this.ledger.userAccount(
          tx,
          transfer.fromDriver.userId,
          DEFAULT_CURRENCY,
        );
        const receiver = await this.ledger.userAccount(
          tx,
          transfer.toDriver.userId,
          DEFAULT_CURRENCY,
        );
        if (Number(sender.balanceCache) < Number(transfer.amount)) {
          throw new BadRequestException(
            "Insufficient funds for driver transfer",
          );
        }
        await this.ledger.post(tx, {
          command: "transferDriverFunds",
          idempotencyKey: `driverTransfer:complete:${transferId}`,
          currency: DEFAULT_CURRENCY,
          referenceType: "DRIVER_TRANSFER",
          referenceId: transferId,
          lines: [
            {
              accountId: sender.id,
              direction: "DEBIT",
              amount: Number(transfer.amount),
            },
            {
              accountId: receiver.id,
              direction: "CREDIT",
              amount: Number(transfer.amount),
            },
          ],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async reconciliationSummary(from?: string, to?: string) {
    const completedAt = this.buildRange(from, to);
    const [
      completedTrips,
      settledTrips,
      unsettledTrips,
      missingPayments,
      missingDriverEarnings,
      missingCompanyEarnings,
      cardPayments,
      paidWithdrawals,
      fundedRequests,
      completedTransfers,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { status: "COMPLETED", completedAt } }),
      this.prisma.trip.count({
        where: { status: "COMPLETED", completedAt, settledAt: { not: null } },
      }),
      this.prisma.trip.count({
        where: { status: "COMPLETED", completedAt, settledAt: null },
      }),
      this.prisma.trip.count({
        where: { status: "COMPLETED", completedAt, payment: { is: null } },
      }),
      this.prisma.trip.count({
        where: {
          status: "COMPLETED",
          completedAt,
          settledAt: { not: null },
          driverEarning: { is: null },
        },
      }),
      this.prisma.trip.count({
        where: {
          status: "COMPLETED",
          completedAt,
          settledAt: { not: null },
          companyEarning: { is: null },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: completedAt,
          method: "CARD",
          status: { in: ["CAPTURED", "PAID"] },
        },
        select: { id: true },
      }),
      this.prisma.withdrawRequest.findMany({
        where: { createdAt: completedAt, status: "PAID" },
        select: { id: true },
      }),
      this.prisma.driverFundingRequest.findMany({
        where: { createdAt: completedAt, status: "FUNDED" },
        select: { id: true },
      }),
      this.prisma.driverTransfer.findMany({
        where: { createdAt: completedAt, status: "COMPLETED" },
        select: { id: true },
      }),
    ]);

    const [
      paymentLedgerMismatch,
      withdrawalLedgerMismatch,
      fundingLedgerMismatch,
      transferLedgerMismatch,
    ] = await Promise.all([
      this.countMissingPostedReferences(
        "PAYMENT",
        cardPayments.map((row) => row.id),
      ),
      this.countMissingPostedReferences(
        "WITHDRAWAL",
        paidWithdrawals.map((row) => row.id),
      ),
      this.countMissingPostedReferences(
        "DRIVER_FUNDING",
        fundedRequests.map((row) => row.id),
      ),
      this.countMissingPostedReferences(
        "DRIVER_TRANSFER",
        completedTransfers.map((row) => row.id),
      ),
    ]);

    return {
      completedTrips,
      settledTrips,
      unsettledTrips,
      missingPayments,
      missingDriverEarnings,
      missingCompanyEarnings,
      paymentLedgerMismatch,
      withdrawalLedgerMismatch,
      fundingLedgerMismatch,
      transferLedgerMismatch,
    };
  }

  async reconciliationItems(
    page: number,
    limit: number,
    type?: string,
    search?: string,
    from?: string,
    to?: string,
  ) {
    const completedAt = this.buildRange(from, to);
    const [
      unsettledTrips,
      tripsMissingPayment,
      tripsMissingDriverEarning,
      tripsMissingCompanyEarning,
      cardPayments,
      paidWithdrawals,
      fundedRequests,
      completedTransfers,
    ] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { status: "COMPLETED", completedAt, settledAt: null },
        take: 50,
        orderBy: { completedAt: "desc" },
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.trip.findMany({
        where: { status: "COMPLETED", completedAt, payment: { is: null } },
        take: 50,
        orderBy: { completedAt: "desc" },
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          status: "COMPLETED",
          completedAt,
          settledAt: { not: null },
          driverEarning: { is: null },
        },
        take: 50,
        orderBy: { completedAt: "desc" },
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          status: "COMPLETED",
          completedAt,
          settledAt: { not: null },
          companyEarning: { is: null },
        },
        take: 50,
        orderBy: { completedAt: "desc" },
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: completedAt,
          method: "CARD",
          status: { in: ["CAPTURED", "PAID"] },
        },
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          trip: { select: { id: true, status: true } },
        },
      }),
      this.prisma.withdrawRequest.findMany({
        where: { createdAt: completedAt, status: "PAID" },
        take: 50,
        orderBy: { processedAt: "desc" },
        include: { user: { select: { name: true, phone: true } } },
      }),
      this.prisma.driverFundingRequest.findMany({
        where: { createdAt: completedAt, status: "FUNDED" },
        take: 50,
        orderBy: { fundedAt: "desc" },
        include: {
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
          requestedBy: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.driverTransfer.findMany({
        where: { createdAt: completedAt, status: "COMPLETED" },
        take: 50,
        orderBy: { completedAt: "desc" },
        include: {
          fromDriver: {
            include: { user: { select: { name: true, phone: true } } },
          },
          toDriver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
    ]);

    const [paymentRefs, withdrawalRefs, fundingRefs, transferRefs] =
      await Promise.all([
        this.postedReferenceSet(
          "PAYMENT",
          cardPayments.map((row) => row.id),
        ),
        this.postedReferenceSet(
          "WITHDRAWAL",
          paidWithdrawals.map((row) => row.id),
        ),
        this.postedReferenceSet(
          "DRIVER_FUNDING",
          fundedRequests.map((row) => row.id),
        ),
        this.postedReferenceSet(
          "DRIVER_TRANSFER",
          completedTransfers.map((row) => row.id),
        ),
      ]);

    const items = [
      ...unsettledTrips.map((trip) => ({
        id: `UNSETTLED_TRIP:${trip.id}`,
        type: "UNSETTLED_TRIP",
        referenceId: trip.id,
        title: "رحلة مكتملة غير مسوّاة",
        detail: `${trip.passenger?.name ?? "-"} / ${trip.driver?.user?.name ?? "-"}`,
        createdAt: trip.completedAt ?? trip.createdAt,
        severity: "high" as const,
      })),
      ...tripsMissingPayment.map((trip) => ({
        id: `MISSING_PAYMENT:${trip.id}`,
        type: "MISSING_PAYMENT",
        referenceId: trip.id,
        title: "رحلة بلا سجل دفع",
        detail: `${trip.paymentMethod} / ${trip.passenger?.name ?? "-"}`,
        createdAt: trip.completedAt ?? trip.createdAt,
        severity: "high" as const,
      })),
      ...tripsMissingDriverEarning.map((trip) => ({
        id: `MISSING_DRIVER_EARNING:${trip.id}`,
        type: "MISSING_DRIVER_EARNING",
        referenceId: trip.id,
        title: "رحلة بلا مستحق سائق",
        detail: `${trip.driver?.user?.name ?? "-"} / ${trip.passenger?.name ?? "-"}`,
        createdAt: trip.completedAt ?? trip.createdAt,
        severity: "medium" as const,
      })),
      ...tripsMissingCompanyEarning.map((trip) => ({
        id: `MISSING_COMPANY_EARNING:${trip.id}`,
        type: "MISSING_COMPANY_EARNING",
        referenceId: trip.id,
        title: "رحلة بلا قيد إيراد شركة",
        detail: `${trip.driver?.user?.name ?? "-"} / ${trip.passenger?.name ?? "-"}`,
        createdAt: trip.completedAt ?? trip.createdAt,
        severity: "medium" as const,
      })),
      ...cardPayments
        .filter((payment) => !paymentRefs.has(payment.id))
        .map((payment) => ({
          id: `PAYMENT_LEDGER_GAP:${payment.id}`,
          type: "PAYMENT_LEDGER_GAP",
          referenceId: payment.id,
          title: "دفعة بطاقة بلا قيد تحصيل",
          detail: `${payment.user.name} / ${payment.trip?.id ?? "-"}`,
          createdAt: payment.createdAt,
          severity: "high" as const,
        })),
      ...paidWithdrawals
        .filter((row) => !withdrawalRefs.has(row.id))
        .map((row) => ({
          id: `WITHDRAWAL_LEDGER_GAP:${row.id}`,
          type: "WITHDRAWAL_LEDGER_GAP",
          referenceId: row.id,
          title: "سحب مدفوع بلا قيد دفتر",
          detail: `${row.user.name} / ${Number(row.amount)} ${DEFAULT_CURRENCY}`,
          createdAt: row.processedAt ?? row.createdAt,
          severity: "high" as const,
        })),
      ...fundedRequests
        .filter((row) => !fundingRefs.has(row.id))
        .map((row) => ({
          id: `FUNDING_LEDGER_GAP:${row.id}`,
          type: "FUNDING_LEDGER_GAP",
          referenceId: row.id,
          title: "شحن ��نفذ بلا قيد دفتر",
          detail: `${row.driver.user.name} / ${Number(row.amount)} ${DEFAULT_CURRENCY}`,
          createdAt: row.fundedAt ?? row.createdAt,
          severity: "medium" as const,
        })),
      ...completedTransfers
        .filter((row) => !transferRefs.has(row.id))
        .map((row) => ({
          id: `TRANSFER_LEDGER_GAP:${row.id}`,
          type: "TRANSFER_LEDGER_GAP",
          referenceId: row.id,
          title: "تحويل مكتمل بلا قيد دفتر",
          detail: `${row.fromDriver.user.name} → ${row.toDriver.user.name}`,
          createdAt: row.completedAt ?? row.createdAt,
          severity: "medium" as const,
        })),
    ];

    const q = search?.trim().toLowerCase();
    const filtered = items
      .filter((item) => (type ? item.type === type : true))
      .filter((item) => {
        if (!q) return true;
        return [item.referenceId, item.title, item.detail, item.type]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    return {
      items: filtered.slice((page - 1) * limit, (page - 1) * limit + limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  async settlementQueue(
    page: number,
    limit: number,
    onlyFailed = false,
    search?: string,
    from?: string,
    to?: string,
  ) {
    const completedAt = this.buildRange(from, to);
    const where: Prisma.TripWhereInput = {
      status: "COMPLETED",
      settledAt: null,
      completedAt,
      ...(onlyFailed ? { settlementError: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: "insensitive" } },
              {
                passenger: { name: { contains: search, mode: "insensitive" } },
              },
              {
                passenger: { phone: { contains: search, mode: "insensitive" } },
              },
              {
                driver: {
                  user: { name: { contains: search, mode: "insensitive" } },
                },
              },
              {
                driver: {
                  user: { phone: { contains: search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
          payment: { select: { method: true, status: true } },
        },
        orderBy: [{ settlementAttempts: "desc" }, { completedAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.trip.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async runSettlementBatch(
    limit = 25,
    onlyFailed = false,
    search?: string,
    from?: string,
    to?: string,
  ) {
    const completedAt = this.buildRange(from, to);
    const trips = await this.prisma.trip.findMany({
      where: {
        status: "COMPLETED",
        settledAt: null,
        completedAt,
        ...(onlyFailed ? { settlementError: { not: null } } : {}),
        ...(search
          ? {
              OR: [
                { id: { contains: search, mode: "insensitive" } },
                {
                  passenger: {
                    name: { contains: search, mode: "insensitive" },
                  },
                },
                {
                  passenger: {
                    phone: { contains: search, mode: "insensitive" },
                  },
                },
                {
                  driver: {
                    user: { name: { contains: search, mode: "insensitive" } },
                  },
                },
                {
                  driver: {
                    user: { phone: { contains: search, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ settlementAttempts: "desc" }, { completedAt: "asc" }],
      select: { id: true },
      take: limit,
    });

    const errors: Array<{ tripId: string; error: string }> = [];
    let succeeded = 0;
    for (const trip of trips) {
      try {
        await this.settleTrip(trip.id);
        succeeded += 1;
      } catch (error) {
        errors.push({
          tripId: trip.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      requested: limit,
      processed: trips.length,
      succeeded,
      failed: errors.length,
      errors,
    };
  }

  private buildRange(from?: string, to?: string) {
    const lte = to ? new Date(to) : new Date();
    const gte = from
      ? new Date(from)
      : new Date(lte.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte, lte };
  }

  private async postedReferenceSet(referenceType: string, ids: string[]) {
    if (ids.length === 0) return new Set<string>();
    const rows = await this.prisma.ledgerTransaction.findMany({
      where: {
        referenceType,
        referenceId: { in: ids },
        status: "POSTED",
      },
      select: { referenceId: true },
    });
    return new Set(
      rows
        .map((row) => row.referenceId)
        .filter((value): value is string => !!value),
    );
  }

  private async countMissingPostedReferences(
    referenceType: string,
    ids: string[],
  ) {
    if (ids.length === 0) return 0;
    const refs = await this.postedReferenceSet(referenceType, ids);
    return ids.filter((id) => !refs.has(id)).length;
  }

  /** واجهة متوافقة (facade): تفوّض عكس المعاملة إلى محرّك دفتر الأستاذ. */
  async reverseTransaction(
    id: string,
    key: string,
    command = "reverseTransaction",
  ): Promise<void> {
    return this.ledger.reverseTransaction(id, key, command);
  }

  async getUserBalance(userId: string, currency = DEFAULT_CURRENCY) {
    return this.ledger.getUserBalance(userId, currency);
  }

  /**
   * الرصيد المقفل غير القابل للسحب (USER:...:LOCKED) — مثل تعويض خصم
   * الكوبون الممنوح للسائق. منفصل عن الرصيد المتاح فلا يدخل السحب/التحويل.
   */
  /**
   * أرصدة السائق ذات الصلة بالعمولة.
   *
   * ثلاث قيم منفصلة قصدًا، وتسميتها في الرد جزء من العقد مع التطبيقات:
   *   commissionWallet  محفظة عمولة السائق — رصيد تشغيلي مسبق الدفع.
   *                     **ليس ربحًا** ولا يُسحب.
   *   commissionCredit  رصيد عمولة الكوبون — يُستهلك في العمولة فقط.
   *   available         مجموعهما = ما يستطيع تغطية عمولة الرحلة القادمة.
   */
  async driverCommissionBalances(
    driverUserId: string,
    currency = DEFAULT_CURRENCY,
  ): Promise<{
    commissionWallet: number;
    commissionCredit: number;
    available: number;
    currency: string;
    withdrawable: false;
  }> {
    const [wallet, credit] = await Promise.all([
      this.ledger.getUserBalance(driverUserId, currency),
      this.ledger.getCommissionCreditBalance(driverUserId, currency),
    ]);
    return {
      commissionWallet: wallet.balance,
      commissionCredit: credit.commissionCredit,
      available: round2(wallet.balance + credit.commissionCredit),
      currency,
      // ثابت في نموذج العمل: لا سحب ولا صرف نقدي لأي من الرصيدين.
      withdrawable: false as const,
    };
  }

  /**
   * يتحقّق أن السائق يملك تغطية عمولة كافية **قبل** أن يُسنَد إلى رحلة
   * تُنشئ التزام عمولة على محفظته.
   *
   * لماذا هنا وليس في التطبيق: التطبيق لا يملك أرصدة الدفتر ولا قواعد
   * العمولة، وأي فحص فيه قابل للتجاوز. هذه الدالة تُنادى **داخل نفس معاملة**
   * إسناد السائق، ومطالبة السائق الذرّية (ONLINE ← ON_TRIP) هي ما يمنع
   * تسابق قبولين متزامنين على نفس الرصيد: لا يمكن للسائق أن يكون في
   * رحلتين معًا، فلا يوجد مسار لصرف نفس الرصيد مرتين. الخصم الفعلي وقت
   * التسوية يجري بعزل Serializable مع حارس «لا رصيد سالب».
   */
  async assertDriverCommissionCoverage(
    client: Prisma.TransactionClient,
    input: {
      driverUserId: string;
      currency: string;
      /** عمولة الرحلة المستحقّة (من لقطة العمولة على الرحلة). */
      commissionDue: number;
      /** ما ستُحصّله المنصّة إلكترونيًا (0 للرحلة النقدية). */
      electronicallyCollected: number;
      tripId?: string;
    },
  ): Promise<void> {
    if (input.commissionDue <= 0) return;
    const [wallet, credit] = await Promise.all([
      client.financialAccount.findUnique({
        where: {
          code: `USER:${input.driverUserId}:${input.currency}:AVAILABLE`,
        },
        select: { balanceCache: true },
      }),
      client.financialAccount.findUnique({
        where: {
          code: `USER:${input.driverUserId}:${input.currency}:COMMISSION_CREDIT`,
        },
        select: { balanceCache: true },
      }),
    ]);
    const walletBalance = Number(wallet?.balanceCache ?? 0);
    const creditBalance = Number(credit?.balanceCache ?? 0);
    const required = prepaidCommissionRequirement({
      commissionDue: input.commissionDue,
      commissionCreditAvailable: creditBalance,
      electronicallyCollected: input.electronicallyCollected,
    });
    if (required <= 0) return;
    if (walletBalance + 1e-9 < required) {
      throw new AppException("DRIVER_COMMISSION_BALANCE_INSUFFICIENT", {
        details: {
          tripId: input.tripId,
          required,
          walletBalance: round2(walletBalance),
          commissionCredit: round2(creditBalance),
          currency: input.currency,
        },
      });
    }
  }

  /**
   * لقطة مالية لسائق واحد للوحة التحكم والدعم.
   *
   * تجيب على السؤال التشغيلي الأكثر تكرارًا: «لماذا لا يستطيع هذا السائق
   * قبول رحلات؟». تُجمع الأرقام من مصادرها الأصلية بلا أي عدّاد موازٍ:
   * الأرصدة من دفتر الأستاذ، والأرباح من إسقاط DriverEarning، وخصومات
   * العمولة من معاملات الدفتر نفسها.
   *
   * تُبرز الفصل بين المفاهيم صراحةً في الرد: محفظة العمولة ورصيد الكوبون
   * وصافي الأرباح واستحقاق عمولة المنصّة حقول مستقلة، وكلها غير قابلة للسحب.
   */
  async driverFinancialSnapshot(driverId: string, currency = DEFAULT_CURRENCY) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true, phone: true } },
      },
    });
    if (!driver) {
      throw new AppException("DRIVER_NOT_FOUND", { details: { driverId } });
    }

    const [balances, earnings, commissionTxns] = await Promise.all([
      this.driverCommissionBalances(driver.userId, currency),
      this.prisma.driverEarning.aggregate({
        where: { driverId },
        _sum: { gross: true, commission: true, net: true },
        _count: { _all: true },
      }),
      this.prisma.ledgerTransaction.findMany({
        where: {
          command: {
            in: [
              "settleTripCommission",
              "grantCouponCommissionCredit",
              "creditWalletTopUp",
              "fundDriverWallet",
              "transferDriverFunds",
              "recoverDriverCancellationPenalty",
            ],
          },
          status: "POSTED",
          entries: {
            some: {
              account: {
                code: { startsWith: `USER:${driver.userId}:${currency}:` },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          command: true,
          referenceType: true,
          referenceId: true,
          reason: true,
          createdAt: true,
          entries: {
            select: {
              direction: true,
              amount: true,
              balanceAfter: true,
              account: { select: { code: true } },
            },
          },
        },
      }),
    ]);

    return {
      driverId: driver.id,
      driverUserId: driver.userId,
      name: driver.user?.name ?? null,
      phone: driver.user?.phone ?? null,
      currency,
      /** رصيد تشغيلي مسبق الدفع لتغطية العمولة — ليس ربحًا وغير قابل للسحب. */
      commissionWallet: balances.commissionWallet,
      /** منفعة كوبون مخصّصة للعمولة — غير قابلة للسحب ولا تُحتسب ربحًا. */
      couponCommissionCredit: balances.commissionCredit,
      /** التغطية المتاحة لعمولة الرحلة القادمة. */
      commissionCoverage: balances.available,
      /** قيم محاسبية للعرض فقط. */
      earnings: {
        withdrawable: false as const,
        trips: earnings._count._all ?? 0,
        gross: round2(Number(earnings._sum.gross ?? 0)),
        net: round2(Number(earnings._sum.net ?? 0)),
      },
      /** استحقاق عمولة المنصّة المتراكم من رحلات هذا السائق. */
      platformCommissionEntitlement: round2(
        Number(earnings._sum.commission ?? 0),
      ),
      recentLedgerActivity: commissionTxns,
    };
  }

  /**
   * إيداع رصيد شحن محفظة مؤكَّد من مزوّد الدفع.
   *
   * نفس القيد لكلا الاستخدامين — رصيد flaminGO Pay للراكب ومحفظة عمولة
   * السائق — لأنهما نفس الحساب المحاسبي (USER:...:AVAILABLE) يختلف معناه
   * التجاري بحسب نوع المستخدم، لا نظامان منفصلان:
   *   DEBIT  PLATFORM:TOPUP_CLEARING (ASSET) — مال وارد بانتظار التسوية البنكية
   *   CREDIT USER:<user>:<CUR>:AVAILABLE   (LIABILITY)
   *
   * خامل التكرار عبر `wallet:topup:<topUpId>`: إعادة إرسال نفس الـwebhook
   * أو ضغط زر التأكيد مرتين لا يُنشئ مالًا جديدًا.
   */
  async creditWalletTopUp(input: {
    topUpId: string;
    userId: string;
    amount: number;
    currency: string;
    provider: string;
    reference?: string | null;
  }): Promise<void> {
    this.ledger.assertCurrency(input.currency);
    if (!Number.isFinite(input.amount) || toMinorUnits(input.amount) <= 0) {
      throw new BadRequestException("Top-up amount must be positive");
    }
    await this.prisma.$transaction(
      async (tx) => {
        const account = await this.ledger.userAccount(
          tx,
          input.userId,
          input.currency,
        );
        const clearing = await this.ledger.platformAccount(
          tx,
          "TOPUP_CLEARING",
          "ASSET",
          input.currency,
        );
        await this.ledger.post(tx, {
          command: "creditWalletTopUp",
          idempotencyKey: `wallet:topup:${input.topUpId}`,
          currency: input.currency,
          referenceType: "WALLET_TOPUP",
          referenceId: input.topUpId,
          reason: input.reference
            ? `wallet_topup:${input.provider}:${input.reference}`
            : `wallet_topup:${input.provider}`,
          lines: [
            {
              accountId: clearing.id,
              direction: "DEBIT",
              amount: input.amount,
            },
            {
              accountId: account.id,
              direction: "CREDIT",
              amount: input.amount,
            },
          ],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getLockedBalance(userId: string, currency = DEFAULT_CURRENCY) {
    return this.ledger.getLockedBalance(userId, currency);
  }

  /** رصيد عمولة الكوبون (غير قابل للسحب — يُستهلك في العمولة فقط). */
  async getCommissionCreditBalance(
    userId: string,
    currency = DEFAULT_CURRENCY,
  ) {
    return this.ledger.getCommissionCreditBalance(userId, currency);
  }

  /**
   * المسار الوحيد لكتابة إسقاط أرباح الرحلة (DriverEarning/CompanyEarning).
   *
   * القيم تُشتقّ حتميًا من **لقطة الرحلة** (fare + discountAmount +
   * commissionPct + سياسة الكوبون) عبر `buildFareBreakdown` — نفس الدالة
   * التي وُلّدت منها قيود الدفتر، وداخل نفس المعاملة. يُستدعى من التسوية ومن
   * إعادة البناء، فتبقى هذه الجداول إسقاطًا (projection) قابلًا لإعادة
   * التوليد لا مصدر حقيقة مستقلاً. آمن للتكرار (idempotent).
   *
   * ملاحظة: هذه قيم **محاسبية/عرضية** لا أرصدة قابلة للسحب. لا يوجد أي
   * مسار في النظام يحوّل `DriverEarning.net` إلى سحب أو صرف نقدي.
   */
  private async projectTripEarnings(
    client: Prisma.TransactionClient,
    params: {
      tripId: string;
      driverId: string;
      gross: number;
      commission: number;
      net: number;
    },
  ): Promise<void> {
    const { tripId, driverId, gross, commission, net } = params;
    await client.driverEarning.upsert({
      where: { tripId },
      create: { driverId, tripId, gross, commission, net },
      update: { driverId, gross, commission, net },
    });
    await client.companyEarning.upsert({
      where: { tripId },
      create: { tripId, amount: commission, source: "ledger_projection" },
      update: { amount: commission, source: "ledger_projection" },
    });
  }

  /**
   * يعيد بناء إسقاطات أرباح الرحلة (DriverEarning/CompanyEarning) من **لقطة
   * الرحلة المحفوظة** بنفس الدالة النقية التي تستعملها التسوية.
   *
   * لماذا من اللقطة وليس من قيود الدفتر: بعد تصحيح نموذج العمل لم يبقَ
   * «صافي السائق» قيدًا دائنًا على حساب مستخدم (الرحلة النقدية لا تُنتج أي
   * قيد أصلًا لأن المال لم يعبر المنصّة)، فاشتقاق الصافي من الدفتر صار
   * مستحيلًا للرحلات النقدية. اللقطة (fare + discountAmount + commissionPct
   * + سياسة الكوبون) مثبّتة على الرحلة وقت الطلب/التسوية ولا تتغير، فهي
   * مصدر حتمي واحد: نفس المدخلات ⇒ نفس الأرقام دائمًا.
   *
   * وتبقى المطابقة قابلة للإثبات: نقارن العمولة المشتقّة بالعمولة المرحّلة
   * فعلًا في `trip:commission:<id>` ونُرجع الفرق إن وُجد بدل إخفائه.
   * آمن للتكرار (idempotent).
   */
  async rebuildTripProjections(tripId: string): Promise<{
    tripId: string;
    rebuilt: boolean;
    ledgerCommission?: number;
    derivedCommission?: number;
    mismatch?: number;
  }> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        driverId: true,
        settledAt: true,
        fare: true,
        discountAmount: true,
        commissionPct: true,
        couponFundingSource: true,
        couponPlatformShare: true,
      },
    });
    if (!trip?.driverId || !trip.settledAt || trip.fare == null) {
      return { tripId, rebuilt: false };
    }

    const discount = Math.max(Number(trip.discountAmount ?? 0), 0);
    const breakdown = buildFareBreakdown({
      baseComputedFare: round2(Number(trip.fare) + discount),
      commissionPct: trip.commissionPct,
      coupon:
        discount > 0
          ? {
              kind: "FIXED",
              value: discount,
              funding: (trip.couponFundingSource ??
                "PLATFORM") as CouponFundingSource,
              platformShare:
                trip.couponPlatformShare != null
                  ? Number(trip.couponPlatformShare)
                  : undefined,
            }
          : null,
    });

    const commissionTxn = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: `trip:commission:${tripId}` },
      include: { entries: { include: { account: true } } },
    });
    const ledgerCommission =
      commissionTxn && commissionTxn.status === "POSTED"
        ? round2(
            commissionTxn.entries
              .filter(
                (entry) =>
                  entry.direction === "CREDIT" &&
                  entry.account.code.startsWith("PLATFORM:COMMISSION:"),
              )
              .reduce((sum, entry) => sum + Number(entry.amount), 0),
          )
        : 0;

    await this.prisma.$transaction((tx) =>
      this.projectTripEarnings(tx, {
        tripId,
        driverId: trip.driverId as string,
        gross: breakdown.grossFare,
        commission: breakdown.commission,
        net: breakdown.driverNet,
      }),
    );
    return {
      tripId,
      rebuilt: true,
      ledgerCommission,
      derivedCommission: breakdown.commission,
      mismatch: round2(breakdown.commission - ledgerCommission),
    };
  }

  /**
   * يعيد بناء إسقاطات الأرباح لأحدث الرحلات المُسوّاة.
   *
   * المصدر هو الرحلات المُسوّاة نفسها (`settledAt != null`) لا معاملات
   * الدفتر: الرحلة النقدية لم تُنتج قيد تحصيل إطلاقًا بعد تصحيح النموذج،
   * فالبحث بـ`command: "settleTrip"` كان سيتجاهل كل الرحلات النقدية.
   * يُرجع أيضًا عدد الرحلات التي اختلفت فيها العمولة المشتقّة عن المرحّلة،
   * فيصبح التعارض رقمًا ظاهرًا في اللوحة لا خطأً صامتًا.
   */
  async rebuildAllTripProjections(
    limit = 500,
  ): Promise<{ scanned: number; rebuilt: number; mismatches: number }> {
    const settled = await this.prisma.trip.findMany({
      where: { status: "COMPLETED", settledAt: { not: null } },
      select: { id: true },
      orderBy: { settledAt: "desc" },
      take: limit,
    });
    let rebuilt = 0;
    let mismatches = 0;
    for (const trip of settled) {
      const result = await this.rebuildTripProjections(trip.id);
      if (result.rebuilt) rebuilt += 1;
      if (result.mismatch != null && Math.abs(result.mismatch) > 0.005) {
        mismatches += 1;
      }
    }
    return { scanned: settled.length, rebuilt, mismatches };
  }
  /**
   * إجماليات الإيراد محسوبة مباشرةً من دفتر الأستاذ (لا من جداول الإسقاط).
   *
   *  - commission: صافي ما قُيّد دائنًا على PLATFORM:COMMISSION ناقص ما قُيّد
   *    مدينًا عليه (الاسترداد/التعويض التاريخي).
   *  - driverNet: صافي ما استحقّ للسائقين، أي الدائن على
   *    PLATFORM:DRIVER_PAYABLE ناقص المدين عليه (العمولة المحتجزة منه).
   *    الأوامر التاريخية التي كانت تُقيّد صافي السائق على حساب مستخدم
   *    (USER:...) ما زالت محسوبة كما هي، فلا تتغيّر أرقام الفترات السابقة.
   *  - gross: commission + driverNet.
   */
  async getLedgerRevenue(range?: { gte?: Date; lte?: Date }): Promise<{
    commission: number;
    driverNet: number;
    gross: number;
  }> {
    const createdAt =
      range && (range.gte || range.lte)
        ? {
            ...(range.gte ? { gte: range.gte } : {}),
            ...(range.lte ? { lte: range.lte } : {}),
          }
        : undefined;
    const transaction: Prisma.LedgerTransactionWhereInput = {
      command: {
        in: [
          "settleTrip",
          "settleTripCommission",
          "grantCouponCommissionCredit",
          // أوامر تاريخية قبل تصحيح النموذج — تبقى محسوبة كما كانت.
          "settleCouponCompensation",
        ],
      },
      status: "POSTED",
      ...(createdAt ? { createdAt } : {}),
    };
    const sumFor = (
      direction: "DEBIT" | "CREDIT",
      codePrefix: string,
    ) =>
      this.prisma.ledgerEntry.aggregate({
        where: {
          direction,
          transaction,
          account: { code: { startsWith: codePrefix } },
        },
        _sum: { amount: true },
      });

    const [
      commissionCredit,
      commissionDebit,
      payableCredit,
      payableDebit,
      legacyUserCredit,
    ] = await this.prisma.$transaction([
      sumFor("CREDIT", "PLATFORM:COMMISSION:"),
      sumFor("DEBIT", "PLATFORM:COMMISSION:"),
      sumFor("CREDIT", "PLATFORM:DRIVER_PAYABLE:"),
      sumFor("DEBIT", "PLATFORM:DRIVER_PAYABLE:"),
      this.prisma.ledgerEntry.aggregate({
        where: {
          direction: "CREDIT",
          transaction: {
            ...transaction,
            command: { in: ["settleCouponCompensation"] },
          },
          account: { code: { startsWith: "USER:" } },
        },
        _sum: { amount: true },
      }),
    ]);

    const commissionNum = round2(
      Number(commissionCredit._sum.amount ?? 0) -
        Number(commissionDebit._sum.amount ?? 0),
    );
    const driverNetNum = round2(
      Number(payableCredit._sum.amount ?? 0) -
        Number(payableDebit._sum.amount ?? 0) +
        Number(legacyUserCredit._sum.amount ?? 0),
    );
    return {
      commission: commissionNum,
      driverNet: driverNetNum,
      gross: round2(commissionNum + driverNetNum),
    };
  }

  /**
   * Periodic ledger integrity check: compares each account's balanceCache with
   * the balance derived from its POSTED ledger entries (Σ CREDIT − Σ DEBIT).
   * Any drift beyond tolerance is persisted as an OPEN reconciliation incident;
   * an account that reconciles auto-resolves its stale OPEN incidents.
   */
  async reconcileLedgerBalances(options?: { tolerance?: number }): Promise<{
    scannedAccounts: number;
    mismatches: number;
    openIncidents: number;
    resolvedIncidents: number;
  }> {
    const tolerance = options?.tolerance ?? 0.005;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        currency: string;
        cached: Prisma.Decimal;
        derived: Prisma.Decimal;
      }>
    >`
      SELECT a.id, a.code, a.currency, a."balanceCache" AS cached,
             COALESCE(SUM(CASE WHEN t.status = 'POSTED' AND e.direction = 'CREDIT' THEN e.amount
                               WHEN t.status = 'POSTED' AND e.direction = 'DEBIT' THEN -e.amount
                               ELSE 0 END), 0) AS derived
      FROM "FinancialAccount" a
      LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
      LEFT JOIN "LedgerTransaction" t ON t.id = e."transactionId"
      GROUP BY a.id, a.code, a.currency, a."balanceCache"
    `;
    let mismatches = 0;
    let resolvedIncidents = 0;
    for (const row of rows) {
      const cached = Number(row.cached);
      const derived = Number(row.derived);
      const difference = accountBalanceDifference(cached, derived);
      if (!isReconciled(cached, derived, tolerance)) {
        mismatches += 1;
        const detail = `balanceCache=${cached} ledger=${derived} diff=${difference}`;
        const open = await this.prisma.ledgerReconciliationIncident.findFirst({
          where: { accountId: row.id, status: "OPEN" },
        });
        if (open) {
          await this.prisma.ledgerReconciliationIncident.update({
            where: { id: open.id },
            data: {
              cachedBalance: cached,
              derivedBalance: derived,
              difference,
              detail,
            },
          });
        } else {
          await this.prisma.ledgerReconciliationIncident.create({
            data: {
              accountId: row.id,
              accountCode: row.code,
              currency: row.currency,
              cachedBalance: cached,
              derivedBalance: derived,
              difference,
              detail,
              status: "OPEN",
            },
          });
        }
        this.logger.error(
          `Ledger reconciliation mismatch on ${row.code}: ${detail}`,
        );
        // تنبيه خارجي (best-effort) — عدم تطابق رصيد يمسّ المال.
        void this.alerts?.emit({
          kind: "reconciliation.mismatch",
          severity: "CRITICAL",
          title: `عدم تطابق دفتر الأستاذ (${row.code})`,
          message: detail,
          context: {
            accountId: row.id,
            accountCode: row.code,
            currency: row.currency,
            difference,
          },
        });
      } else {
        const stale = await this.prisma.ledgerReconciliationIncident.updateMany(
          {
            where: { accountId: row.id, status: "OPEN" },
            data: {
              status: "RESOLVED",
              resolvedBy: "SYSTEM",
              resolvedAt: new Date(),
            },
          },
        );
        resolvedIncidents += stale.count;
      }
    }
    const openIncidents = await this.prisma.ledgerReconciliationIncident.count({
      where: { status: "OPEN" },
    });
    return {
      scannedAccounts: rows.length,
      mismatches,
      openIncidents,
      resolvedIncidents,
    };
  }

  @Cron("0 */30 * * * *")
  async scheduledLedgerReconciliation(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.lock.runExclusive(
      "cron:ledger-reconciliation",
      () => this.scheduledLedgerReconciliationTask(),
      300000,
    );
  }

  /** المنطق الفعلي للمهمة بع�� الحصول على القفل. */
  async scheduledLedgerReconciliationTask(): Promise<void> {
    try {
      const result = await this.reconcileLedgerBalances();
      if (result.mismatches > 0) {
        this.logger.error(
          `Ledger reconciliation found ${result.mismatches} mismatch(es); ${result.openIncidents} open incident(s).`,
        );
        void this.alerts?.emit({
          kind: "reconciliation.summary",
          severity: "CRITICAL",
          title: "فحص التطابق الدوري وجد اختلافات",
          message: `${result.mismatches} اختلاف، ${result.openIncidents} حادثة مفتوحة.`,
          context: {
            mismatches: result.mismatches,
            openIncidents: result.openIncidents,
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Ledger reconciliation cron failed: ${(error as Error).message}`,
      );
    }
  }

  async listReconciliationIncidents(
    page: number,
    limit: number,
    status?: "OPEN" | "RESOLVED" | "IGNORED",
  ) {
    const where: Prisma.LedgerReconciliationIncidentWhereInput = status
      ? { status }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ledgerReconciliationIncident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ledgerReconciliationIncident.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async resolveReconciliationIncident(
    id: string,
    resolvedBy: string,
    status: "RESOLVED" | "IGNORED" = "RESOLVED",
  ) {
    const existing = await this.prisma.ledgerReconciliationIncident.findUnique({
      where: { id },
    });
    if (!existing)
      throw new NotFoundException("Reconciliation incident not found");
    return this.prisma.ledgerReconciliationIncident.update({
      where: { id },
      data: { status, resolvedBy, resolvedAt: new Date() },
    });
  }

  async listAccounts(page: number, limit: number, search?: string) {
    const where: Prisma.FinancialAccountWhereInput = search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            {
              party: { displayName: { contains: search, mode: "insensitive" } },
            },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.financialAccount.findMany({
        where,
        include: { party: true },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.financialAccount.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async listTransactions(
    page: number,
    limit: number,
    status?: "PENDING" | "POSTED" | "FAILED" | "REVERSED" | "CANCELLED",
    referenceType?: string,
    search?: string,
  ) {
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(status ? { status } : {}),
      ...(referenceType ? { referenceType } : {}),
      ...(search
        ? {
            OR: [
              { command: { contains: search, mode: "insensitive" } },
              { idempotencyKey: { contains: search, mode: "insensitive" } },
              { referenceId: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ledgerTransaction.findMany({
        where,
        include: {
          entries: { include: { account: { include: { party: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ledgerTransaction.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
