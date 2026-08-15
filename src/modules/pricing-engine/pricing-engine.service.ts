import { DEFAULT_CURRENCY } from "../../common/money.util";
import { Injectable, Optional } from "@nestjs/common";
import { RideClass } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { round2 } from "../../common/money.util";
import { haversineKm, estimateDurationSec } from "../matching/geo.util";
import { RoutingService, type RouteResult } from "../geo/routing.service";
import { computeFare } from "../matching/pricing.util";
import {
  buildFareBreakdown,
  computeCancellationFee,
  computeWaitingCharge,
  type CancellationStage,
  type CouponPolicy,
  type FareBreakdown,
  type WaitingPolicy,
} from "./fare-breakdown.util";
import { PricingPolicyService } from "./pricing-policy.service";
import { CountryConfigService } from "../country-config/country-config.service";
import { CityScalingService } from "../city-scaling/city-scaling.service";
import { GrowthService } from "../growth/growth.service";
import { SurgeService } from "./surge.service";

/**
 * سياق طلب التسعير. كل الحقول اختيارية ليمكن استخدام المحرك
 * لحساب أجرة كاملة (بإحداثيات أو مسافة جاهزة) أو لمجرد حلّ قاعدة السعر.
 */
export interface PricingContext {
  vehicleTypeId?: string;
  rideClass?: RideClass;
  cityId?: string;
  /**
   * المرحلة 8: الولاية كنطاق تسعير وسيط بين المدينة والوطن.
   * لا يرسله العميل مطلقًا؛ يُشتق في Backend من cityId (انظر resolveWilayaId).
   * يُستخدم للتصنيف والتسعير فقط، ولا يدخل إطلاقًا في حساب المسافة أو المدة.
   */
  wilayaId?: string;
  serviceAreaId?: string;
  /** @deprecated منذ المرحلة 8 — استخدم wilayaId */
  state?: string;
  country?: string;
  customerType?: string;
  couponCode?: string;
  subjectId?: string;
  at?: Date;
  distanceKm?: number;
  durationSec?: number;
  /**
   * المرحلة 7 — يضبطه **الخادم فقط** (محاكاة اللوحة/STAFF) للسماح باستخدام
   * distanceKm/durationSec الواردين بدل استدعاء محرك التوجيه. لا يُقبل
   * إطلاقًا من تطبيق الراكب أو السائق (انظر resolveRoute و FareQuotesService).
   */
  trustClientMetrics?: boolean;
  /**
   * ثوانِ الانتظار المحتسبة **خادميًا** (من طوابع أحداث الرحلة)، تُستخدم
   * لاحتساب رسم الانتظار وفق سياسة اللوحة. لا يرسلها العميل.
   */
  waitingSeconds?: number;
  pickupLat?: number;
  pickupLng?: number;
  destLat?: number;
  destLng?: number;
}

export type PricingSource =
  "VEHICLE_PRICING_RULE" | "LEGACY_PRICING_RULE" | "DEFAULT";

export interface PricingRuleUsed {
  source: PricingSource;
  id: string | null;
  name: string | null;
  priority: number | null;
}

export interface PricingResult {
  currency: string;
  fare: number;
  commission: number;
  commissionPct: number;
  distanceKm: number;
  durationSec: number;
  ruleUsed: PricingRuleUsed;
  experimentVariant: string | null;
  /**
   * المرحلة 7 — الرسوم المضافة قبل الضريبة (رسوم الخدمة والانتظار من
   * إعدادات اللوحة) مع الأجرة قبل إضافتها، لعرضها في المحاكاة والفاتورة
   * دون إعادة حسابها في أي مكان آخر.
   */
  extras: {
    serviceFee: number;
    waitingCharge: number;
    waitingSeconds: number;
    fareBeforeExtras: number;
  };
  /**
   * معلومات المسار الفعلي عند حساب المسافة من محرك التوجيه.
   * `approximate: true` تعني أن المسافة تقديرية (خط مستقيم) وليست طرقًا حقيقية.
   */
  route?: {
    polyline: string;
    provider: string;
    source: string;
    approximate: boolean;
  };
  breakdown: {
    baseFare: number;
    distanceCost: number;
    timeCost: number;
    peakMultiplier: number;
    /** جزء الطلب الحيّ داخل peakMultiplier (1 = بلا تصاعد). */
    surgeMultiplier: number;
    minFare: number;
    maxFare: number | null;
    negotiationMin: number | null;
    negotiationMax: number | null;
    taxNet: number;
    taxAmount: number;
    taxGross: number;
    countryCode: string | null;
  };
}

interface ResolvedPricing {
  baseFare: number | { toString(): string };
  perKm: number | { toString(): string };
  perMin: number | { toString(): string };
  minFare: number | { toString(): string };
  maxFare: number | { toString(): string } | null;
  currency: string;
  peakMultiplier: number;
  commissionPct: number;
  negotiationMin: number | null;
  negotiationMax: number | null;
  ruleUsed: PricingRuleUsed;
}

// قيم احتياطية إن لم يوجد تسعير في قاعدة البيانات.
const DEFAULT_RULE = {
  baseFare: 50,
  perKm: 20,
  perMin: 3,
  minFare: 100,
  maxFare: null as number | null,
  currency: DEFAULT_CURRENCY,
};

const DEFAULT_COMMISSION_PCT = 15;

/**
 * محرك التسعير المستقل (Pricing Engine).
 * مستقل تمامًا عن المطابقة والـ Controllers، وقابل للاستخدام في أي مكان
 * (ركوب، توصيل طعام، طرود...). يختار أنسب قاعدة سعر حسب المطابقة
 * (منطقة/مدينة/وقت/عميل/كوبون) ثم الأولوية، ويُرجع السعر والعمولة والقاعدة المستخدمة.
 */
@Injectable()
export class PricingEngineService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly countryConfig?: CountryConfigService,
    @Optional() private readonly cityScaling?: CityScalingService,
    @Optional() private readonly growth?: GrowthService,
    @Optional() private readonly routing?: RoutingService,
    @Optional() private readonly surge?: SurgeService,
    @Optional() private readonly policy?: PricingPolicyService,
  ) {}

  /**
   * رسم الإلغاء وفق سياسة اللوحة (pricing.fees.cancellation).
   *
   * إغلاق المرحلة 10 — قرار D-4: أُلغيت رسوم إلغاء الراكب نهائيًا،
   * فلم يبقَ لهذه الدالة أي مستدعٍ في مسارات الإلغاء أو التسوية.
   * تُرك كما هي للمرجعية وللاختبارات فقط، ولا يجوز ربطها بأي مسار
   * يخصم من الراكب (لا من محفظته ولا من أجرة الرحلة).
   * أي إعادة تفعيل تحتاج قرارًا صريحًا من مالك المشروع.
   */
  async cancellationFee(
    stage: CancellationStage,
    elapsedSecondsSinceAccept = 0,
  ): Promise<{ fee: number; driverCompensationPct: number }> {
    const policy = await this.policy?.cancellationPolicy();
    if (!policy) return { fee: 0, driverCompensationPct: 0 };
    return {
      fee: computeCancellationFee(stage, policy, elapsedSecondsSinceAccept),
      driverCompensationPct: policy.driverCompensationPct ?? 0,
    };
  }

  /**
   * يركّب الأجرة النهائية وخريطة التسوية (توزيع سائق/منصة) انطلاقًا من نتيجة quote
   * مع إضافات الانتظار/الجسور/الرسوم ومصدر تمويل الكوبون — دون أي اعتماد على قاعدة البيانات.
   * يُستخدم لربط التسعير بالتسوية المالية (settleTrip) بما يحفظ توازن المال.
   */
  composeFare(
    result: Pick<PricingResult, "fare" | "commissionPct">,
    extras: {
      tolls?: number;
      surcharges?: number;
      waitingSeconds?: number;
      waitingPolicy?: WaitingPolicy | null;
      coupon?: CouponPolicy | null;
    } = {},
  ): FareBreakdown {
    return buildFareBreakdown({
      baseComputedFare: result.fare,
      commissionPct: result.commissionPct,
      tolls: extras.tolls,
      surcharges: extras.surcharges,
      waitingSeconds: extras.waitingSeconds,
      waitingPolicy: extras.waitingPolicy,
      coupon: extras.coupon,
    });
  }

  /**
   * يطلب مسارًا حقيقيًا من محرك التوجيه (Google Routes) عند توفر الإحداثيات.
   *
   * تغيير المرحلة 7 (أمني مهم):
   * سابقًا كان يُرجع null فورًا إذا أرسل المتصل distanceKm + durationSec،
   * أي أن العميل كان يستطيع تجاوز التوجيه وفرض مسافة ومدة من عنده
   * (تلاعب مباشر بالسعر). الآن ما دامت الإحداثيات متوفرة نسأل المزوّد
   * دائمًا، ونتجاهل قيم العميل (انظر quote).
   *
   * الاستثناء الوحيد: trustClientMetrics يضبطه الخادم نفسه في محاكاة اللوحة
   * (STAFF) حيث يريد الموظف اختبار مسافة افتراضية بلا استهلاك طلب Routes.
   *
   * - أي فشل يُرجع null فيسقط الحساب للتقدير القديم — التسعير لا يتوقف أبدًا.
   */
  private async resolveRoute(ctx: PricingContext): Promise<RouteResult | null> {
    if (!this.routing) return null;
    if (
      ctx.trustClientMetrics &&
      ctx.distanceKm != null &&
      ctx.durationSec != null
    ) {
      return null;
    }
    if (
      ctx.pickupLat == null ||
      ctx.pickupLng == null ||
      ctx.destLat == null ||
      ctx.destLng == null
    ) {
      return null;
    }
    try {
      return await this.routing.route(
        { lat: ctx.pickupLat, lng: ctx.pickupLng },
        { lat: ctx.destLat, lng: ctx.destLng },
      );
    } catch {
      return null;
    }
  }

  /** حساب أجرة كاملة (السع�� + العمولة + القاعدة المستخدمة). */
  async quote(ctx: PricingContext): Promise<PricingResult> {
    // المسافة والمدة من محرك التوجيه (طرق حقيقية) وليس خطًا مستقيمًا،
    // لأن فرق 20–40% في المسافة يعني أجرة غير عادلة للراكب أو للسائق.
    const routed = await this.resolveRoute(ctx);
    // أولوية المصدر (المرحلة 7): ما يعود من مزوّد التوجيه أولًا دائمًا،
    // ثم ما أرسله العميل، ثم التقدير الهوائي. الترتيب كان معكوسًا قبل المرحلة 7
    // فكانت قيمة العميل تفوز على Google Routes.
    const distanceKm =
      routed?.distanceKm ??
      ctx.distanceKm ??
      (ctx.pickupLat != null &&
      ctx.pickupLng != null &&
      ctx.destLat != null &&
      ctx.destLng != null
        ? Math.round(
            haversineKm(
              ctx.pickupLat,
              ctx.pickupLng,
              ctx.destLat,
              ctx.destLng,
            ) * 100,
          ) / 100
        : 0);
    const durationSec =
      routed?.durationSeconds ??
      ctx.durationSec ??
      estimateDurationSec(distanceKm);

    const rule = await this.resolve(ctx);
    const countryCode = await this.resolveCountryCode(ctx);
    // مضاعف الطلب الحيّ (surge) من نسبة الطلب/العرض لحظة الطلب،
    // يُضرب في مضاعف الذروة الثابت ثمّ يُحصر بسقف المدينة (cappedSurge).
    const liveSurge =
      this.surge && ctx.pickupLat != null && ctx.pickupLng != null
        ? await this.surge.multiplierAt(ctx.pickupLat, ctx.pickupLng)
        : 1;
    const requestedMultiplier = rule.peakMultiplier * liveSurge;
    const peakMultiplier =
      ctx.cityId && this.cityScaling
        ? await this.cityScaling.cappedSurge(ctx.cityId, requestedMultiplier)
        : requestedMultiplier;
    const baseFare = Number(rule.baseFare);
    const minFare = Number(rule.minFare);
    const maxFare = rule.maxFare != null ? Number(rule.maxFare) : null;

    const { fare, distanceCost, timeCost } = computeFare(
      {
        baseFare,
        perKm: Number(rule.perKm),
        perMin: Number(rule.perMin),
        minFare,
        maxFare,
      },
      distanceKm,
      durationSec,
      peakMultiplier,
    );

    // المرحلة 7: رسوم الخدمة والانتظار من إعدادات اللوحة (pricing.fees).
    // تُضاف قبل الضريبة وقبل احتساب العمولة، لأن العمولة في buildFareBreakdown
    // تُحتسب أيضًا على (الأساس + الانتظار + الرسوم)، فيبقى المساران متسقين.
    const serviceFee = this.policy ? await this.policy.serviceFee() : 0;
    const waitingPolicy = this.policy
      ? await this.policy.waitingPolicy()
      : null;
    const waitingSeconds = Math.max(0, Math.round(ctx.waitingSeconds ?? 0));
    const waitingCharge =
      waitingPolicy && waitingSeconds > 0
        ? computeWaitingCharge(waitingSeconds, waitingPolicy)
        : 0;
    const fareBeforeExtras = fare;
    const fareWithExtras = round2(fare + serviceFee + waitingCharge);

    const tax =
      countryCode && this.countryConfig
        ? await this.countryConfig.taxFor(countryCode, fareWithExtras)
        : { net: fareWithExtras, tax: 0, gross: fareWithExtras };
    const currency =
      countryCode && this.countryConfig
        ? await this.countryConfig.currencyFor(countryCode)
        : rule.currency;
    const experimentVariant = await this.assignPricingVariant(ctx.subjectId);
    const finalFare = tax.gross;
    const commission = round2((finalFare * rule.commissionPct) / 100);

    return {
      currency,
      route: routed
        ? {
            polyline: routed.polyline,
            provider: routed.provider,
            source: routed.source,
            approximate: routed.approximate,
          }
        : undefined,
      fare: finalFare,
      commission,
      commissionPct: rule.commissionPct,
      distanceKm,
      durationSec,
      ruleUsed: rule.ruleUsed,
      experimentVariant,
      extras: {
        serviceFee,
        waitingCharge,
        waitingSeconds,
        fareBeforeExtras,
      },
      breakdown: {
        baseFare,
        distanceCost,
        timeCost,
        peakMultiplier,
        surgeMultiplier: liveSurge,
        minFare,
        maxFare,
        negotiationMin: rule.negotiationMin,
        negotiationMax: rule.negotiationMax,
        taxNet: tax.net,
        taxAmount: tax.tax,
        taxGross: tax.gross,
        countryCode,
      },
    };
  }

  private async resolveCountryCode(
    ctx: PricingContext,
  ): Promise<string | null> {
    if (ctx.country?.trim()) return ctx.country.trim().toUpperCase();
    if (!ctx.cityId) return null;
    const city = await this.prisma.city.findUnique({
      where: { id: ctx.cityId },
      select: { country: true },
    });
    return city?.country?.trim().toUpperCase() ?? null;
  }

  private async assignPricingVariant(
    subjectId?: string,
  ): Promise<string | null> {
    if (!subjectId || !this.growth) return null;
    const key = process.env.PRICING_EXPERIMENT_KEY?.trim() || "pricing-fare-v1";
    try {
      const assignment = await this.growth.assign(key, subjectId);
      return assignment.variant;
    } catch {
      return null;
    }
  }

  /**
   * يحلّ أنسب قاعدة تسعير:
   * 1) VehiclePricingRule الديناميكية (الأعلى أولوية ثم الأكثر تخصيصًا مع مطابقة الوقت/المنطقة).
   * 2) PricingRule القديم (حسب الفئة/المدينة).
   * 3) قيم افتراضية.
   */
  async resolve(ctx: PricingContext): Promise<ResolvedPricing> {
    const now = ctx.at ?? new Date();

    if (ctx.vehicleTypeId) {
      const rules = await this.prisma.vehiclePricingRule.findMany({
        where: {
          vehicleTypeId: ctx.vehicleTypeId,
          isActive: true,
          deletedAt: null,
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });
      const best = this.pickBestRule(rules, ctx, now);
      if (best) {
        return {
          baseFare: best.baseFare,
          perKm: best.perKm,
          perMin: best.perMin,
          minFare: best.minFare,
          maxFare: best.maxFare,
          currency: best.currency,
          peakMultiplier: best.peakMultiplier ?? 1,
          commissionPct: best.commissionPct ?? DEFAULT_COMMISSION_PCT,
          negotiationMin:
            best.negotiationMin != null ? Number(best.negotiationMin) : null,
          negotiationMax:
            best.negotiationMax != null ? Number(best.negotiationMax) : null,
          ruleUsed: {
            source: "VEHICLE_PRICING_RULE",
            id: best.id,
            name: best.name ?? null,
            priority: best.priority,
          },
        };
      }
    }

    const legacy = await this.resolveLegacy(
      ctx.rideClass ?? "ECONOMY",
      ctx.cityId,
    );
    const peakMultiplier = await this.currentPeakMultiplier(legacy.id, now);
    return {
      baseFare: legacy.baseFare,
      perKm: legacy.perKm,
      perMin: legacy.perMin,
      minFare: legacy.minFare,
      maxFare: legacy.maxFare,
      currency: legacy.currency,
      peakMultiplier,
      commissionPct: DEFAULT_COMMISSION_PCT,
      negotiationMin: null,
      negotiationMax: null,
      ruleUsed: {
        source: legacy.id ? "LEGACY_PRICING_RULE" : "DEFAULT",
        id: legacy.id,
        name: null,
        priority: null,
      },
    };
  }

  /**
   * يختار أن��ب قاعدة: يستبعد القواعد ذات القيود غير المتحققة، ثم يرتّب حسب الأولوية ثم التخصيص.
   */
  private pickBestRule<
    T extends {
      cityId: string | null;
      wilayaId: string | null;
      serviceAreaId: string | null;
      state: string | null;
      country: string | null;
      customerType: string | null;
      couponCode: string | null;
      validFrom: Date | null;
      validTo: Date | null;
      daysOfWeek: number[];
      startTime: string | null;
      endTime: string | null;
      priority: number;
    },
  >(rules: T[], ctx: PricingContext, now: Date): T | undefined {
    const { day, minutes: hm } = this.localDayMinutes(now);
    const matchStr = (ruleVal: string | null, optVal?: string) =>
      ruleVal == null || ruleVal === optVal;

    const candidates = rules.filter((r) => {
      if (!matchStr(r.cityId, ctx.cityId)) return false;
      if (!matchStr(r.wilayaId, ctx.wilayaId)) return false;
      if (!matchStr(r.serviceAreaId, ctx.serviceAreaId)) return false;
      if (!matchStr(r.state, ctx.state)) return false;
      if (!matchStr(r.country, ctx.country)) return false;
      if (
        r.customerType != null &&
        r.customerType !== "ALL" &&
        r.customerType !== ctx.customerType
      )
        return false;
      if (!matchStr(r.couponCode, ctx.couponCode)) return false;
      if (r.validFrom && now < r.validFrom) return false;
      if (r.validTo && now > r.validTo) return false;
      if (r.daysOfWeek.length > 0 && !r.daysOfWeek.includes(day)) return false;
      if (r.startTime && r.endTime) {
        const s = this.parseHm(r.startTime);
        const e = this.parseHm(r.endTime);
        const active = s <= e ? hm >= s && hm <= e : hm >= s || hm <= e;
        if (!active) return false;
      }
      return true;
    });
    if (candidates.length === 0) return undefined;

    // المدينة تزن 2 والولاية تزن 1: لو تساوتا لأصبحت قاعدة "ولاية + دولة"
    // تهزم قاعدة "مدينة" الأدق، وهذا عكس المطلوب: مدينة > ولاية > وطني.
    const specificity = (r: T) =>
      (r.cityId ? 2 : 0) +
      (r.wilayaId ? 1 : 0) +
      (r.serviceAreaId ? 1 : 0) +
      (r.state ? 1 : 0) +
      (r.country ? 1 : 0) +
      (r.customerType && r.customerType !== "ALL" ? 1 : 0) +
      (r.couponCode ? 1 : 0) +
      (r.startTime && r.endTime ? 1 : 0);

    return candidates.sort(
      (a, b) => b.priority - a.priority || specificity(b) - specificity(a),
    )[0];
  }

  /**
   * المرحلة 8 — يشتق الولاية من المدينة.
   *
   * لماذا الاشتقاق وليس الثقة بما يرسله العميل:
   * نفس مبدأ المرحلة 7 في distance/duration. لو قبلنا wilayaId من التطبيق،
   * لأمكن لراكب ادّعاء ولاية رخيصة والحصول على تسعيرة أقل. Backend هو مصدر الحقيقة.
   */
  private async resolveWilayaId(ctx: PricingContext): Promise<string | undefined> {
    if (!ctx.cityId) return undefined;
    const city = await this.prisma.city.findUnique({
      where: { id: ctx.cityId },
      select: { wilayaId: true },
    });
    return city?.wilayaId ?? undefined;
  }

  /**
   * أولوية القواعد بعد المرحلة 8: مدينة > ولاية > وطني > افتراضي.
   *
   * القاعدة الوطنية هي ما كان cityId وwilayaId كلاهما null. من المهم استثناء
   * قواعد المدن/الولايات الأخرى صراحة في المستوى الوطني، وإلا قد تُلتقط قاعدة
   * خاصة بوهران لرحلة في قسنطينة لمجرد أنها الأقدم.
   */
  private async resolveLegacy(
    rideClass: RideClass,
    cityId?: string,
    wilayaId?: string,
  ) {
    const cityRule = cityId
      ? await this.prisma.pricingRule.findFirst({
          where: { cityId, rideClass, isActive: true },
        })
      : null;
    if (cityRule) return cityRule;

    const wilayaRule = wilayaId
      ? await this.prisma.pricingRule.findFirst({
          where: { wilayaId, cityId: null, rideClass, isActive: true },
          orderBy: { createdAt: "asc" },
        })
      : null;
    if (wilayaRule) return wilayaRule;

    const nationalRule = await this.prisma.pricingRule.findFirst({
      where: { cityId: null, wilayaId: null, rideClass, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (nationalRule) return nationalRule;

    return { id: null as string | null, ...DEFAULT_RULE };
  }

  private async currentPeakMultiplier(
    ruleId: string | null,
    now: Date,
  ): Promise<number> {
    if (!ruleId) return 1;
    const peaks = await this.prisma.peakPricing.findMany({
      where: { pricingRuleId: ruleId, isActive: true },
    });
    if (peaks.length === 0) return 1;
    const { day, minutes: hm } = this.localDayMinutes(now);
    for (const p of peaks) {
      if (p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(day)) continue;
      const start = this.parseHm(p.startTime);
      const end = this.parseHm(p.endTime);
      const active =
        start <= end ? hm >= start && hm <= end : hm >= start || hm <= end;
      if (active) return p.multiplier;
    }
    return 1;
  }

  /**
   * يحسب اليوم (0=الأحد) والدقائق منذ منتصف الليل بتوقيت المنصة الفعلي
   * (APP_TIMEZONE، الافتراضي Africa/Algiers) بدل توقيت الخادم (UTC على Render)،
   * حتى تعمل نوافذ التسعير الزمنية وأيام الأسبوع وساعات الذروة بدقة محليًا.
   */
  private localDayMinutes(now: Date): { day: number; minutes: number } {
    const tz = process.env.APP_TIMEZONE || "Africa/Algiers";
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(now);
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const weekdayIndex: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const day = weekdayIndex[map.weekday] ?? now.getDay();
      let hour = parseInt(map.hour, 10);
      if (hour === 24) hour = 0; // بعض البيئات تُرجع 24 عند منتصف الليل
      const minute = parseInt(map.minute, 10);
      return { day, minutes: hour * 60 + minute };
    } catch {
      return {
        day: now.getDay(),
        minutes: now.getHours() * 60 + now.getMinutes(),
      };
    }
  }

  private parseHm(value: string): number {
    const [h, m] = value.split(":").map((n) => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  }
}
