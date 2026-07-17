/**
 * طبقة تركيب الأجرة النهائية وخريطة التسوية (Fare → Settlement Mapping) — دوال نقية بلا DB.
 *
 * تأخذ الأجرة الأساسية (بعد surge والحدّ الأدنى/الأقصى من computeFare)
 * وتضيف رسوم الانتظار/الإلغاء/الجسور (tolls) والرسوم الإضافية،
 * ثم تطبّق خصم الكوبون مع تحديد **مصدر التمويل** (المنصّة/السائق/مشترك)،
 * وأخيرًا توزّع المبلغ بين السائق والمنصّة بما يحفظ توازن المال (money conservation).
 */

import { round2 } from "../../common/money.util";

/** من يتحمّل تكلفة خصم الكوبون. */
export type CouponFundingSource = "PLATFORM" | "DRIVER" | "SHARED";
export type CouponKind = "PERCENT" | "FIXED";

export interface CouponPolicy {
  kind: CouponKind;
  /** نسبة مئوية (0..100) لـ PERCENT أو مبلغ ثابت لـ FIXED. */
  value: number;
  /** سقف الخصم (اختياري). */
  maxDiscount?: number | null;
  funding: CouponFundingSource;
  /** حصة المنصة من الخصم عند SHARED (0..1، الافتراضي 0.5). */
  platformShare?: number;
}

export interface WaitingPolicy {
  /** ثوانٍ انتظار مجانية قبل بدء التسعير. */
  freeSeconds: number;
  /** رسوم كل دقيقة انتظار (تُحسب بالتقريب لأعلى). */
  perMinute: number;
  /** سقف رسوم الانتظار (اختياري). */
  maxCharge?: number | null;
}

export type CancellationStage =
  | "BEFORE_ACCEPT"
  | "AFTER_ACCEPT"
  | "AFTER_ARRIVAL";

export interface CancellationPolicy {
  /** نافذة إلغاء مجانية بعد القبول (ثوانٍ). */
  graceSeconds: number;
  feeAfterAccept: number;
  feeAfterArrival: number;
  /** نسبة تعويض السائق من الرسم (0..100)، تُستخدم عند تسوية الرسم ماليًا. */
  driverCompensationPct?: number;
}

export interface FareExtrasInput {
  /** الأجرة الأساسية من computeFare (بعد surge والحدّ الأدنى/الأقصى). */
  baseComputedFare: number;
  /** نسبة عمولة المنصة (%). */
  commissionPct: number;
  /** رسوم جسور/طرق — تُمرّر بالكامل للسائق (لا عمولة عليها). */
  tolls?: number;
  waitingSeconds?: number;
  waitingPolicy?: WaitingPolicy | null;
  /** رسوم إضافية (مطار/حجز...) — تدخل في قاعدة العمولة. */
  surcharges?: number;
  coupon?: CouponPolicy | null;
}

export interface CouponBreakdown {
  discount: number;
  platformFunded: number;
  driverFunded: number;
}

export interface FareBreakdown {
  /** ما يدفعه الراكب فعليًا (بعد الخصم). */
  riderPays: number;
  /** قيمة الرحلة قبل الخصم (أساس + انتظار + رسوم + جسور). */
  grossFare: number;
  /** قاعدة احتساب العمولة (بدون الجسور). */
  commissionBase: number;
  commission: number;
  /** أرباح السائق قبل خصم الكوبون. */
  driverEarnings: number;
  coupon: CouponBreakdown;
  /** صافي السائق بعد تحمّله حصته من الكوبون. */
  driverNet: number;
  /** صافي المنصة بعد تحمّلها حصتها من الكوبون. */
  platformNet: number;
  components: {
    baseComputedFare: number;
    tolls: number;
    waitingCharge: number;
    surcharges: number;
  };
}

/** رسوم الانتظار: دقائق تجاوز المجاني (تقريب لأعلى) × رسوم الدقيقة، مقيّدة بالسقف. */
export function computeWaitingCharge(
  waitingSeconds: number,
  policy?: WaitingPolicy | null,
): number {
  if (!policy || waitingSeconds <= policy.freeSeconds) return 0;
  const chargeableMinutes = Math.ceil(
    (waitingSeconds - policy.freeSeconds) / 60,
  );
  let charge = chargeableMinutes * policy.perMinute;
  if (policy.maxCharge != null) charge = Math.min(charge, policy.maxCharge);
  return round2(Math.max(charge, 0));
}

/** رسوم الإلغاء حسب مرحلة الرحلة ونافذة السماح. */
export function computeCancellationFee(
  stage: CancellationStage,
  policy: CancellationPolicy,
  elapsedSecondsSinceAccept = 0,
): number {
  switch (stage) {
    case "BEFORE_ACCEPT":
      return 0;
    case "AFTER_ACCEPT":
      return elapsedSecondsSinceAccept <= policy.graceSeconds
        ? 0
        : round2(Math.max(policy.feeAfterAccept, 0));
    case "AFTER_ARRIVAL":
      return round2(Math.max(policy.feeAfterArrival, 0));
    default:
      return 0;
  }
}

/** خصم الكوبون مع توزيع مصدر التمويل؛ الخصم لا يتجاوز المبلغ. */
export function computeCouponDiscount(
  amount: number,
  coupon?: CouponPolicy | null,
): CouponBreakdown {
  if (!coupon || amount <= 0) {
    return { discount: 0, platformFunded: 0, driverFunded: 0 };
  }
  const raw =
    coupon.kind === "PERCENT" ? (amount * coupon.value) / 100 : coupon.value;
  let discount = Math.min(Math.max(raw, 0), amount);
  if (coupon.maxDiscount != null) {
    discount = Math.min(discount, coupon.maxDiscount);
  }
  discount = round2(discount);

  if (coupon.funding === "DRIVER") {
    return { discount, platformFunded: 0, driverFunded: discount };
  }
  if (coupon.funding === "SHARED") {
    const share = coupon.platformShare ?? 0.5;
    const platformFunded = round2(discount * Math.min(Math.max(share, 0), 1));
    return {
      discount,
      platformFunded,
      driverFunded: round2(discount - platformFunded),
    };
  }
  // PLATFORM (الافتراضي): المنصة تتحمل كامل الخصم.
  return { discount, platformFunded: discount, driverFunded: 0 };
}

/**
 * يركّب الأجرة النهائية ويوزّعها بين السائق والمنصة.
 *
 * ثوابت التوازن:
 *   riderPays = grossFare − discount
 *   riderPays = driverNet + platformNet
 * أي أن ما يدفعه الراكب يُقسم بالكامل بين السائق والمنصة؛
 * ومصدر تمويل الكوبون يُحدّد من يتحمّل الخصم (السائق يبقى كاملًا إن موّلته المنصة).
 */
export function buildFareBreakdown(input: FareExtrasInput): FareBreakdown {
  const baseComputedFare = round2(Math.max(input.baseComputedFare, 0));
  const tolls = round2(Math.max(input.tolls ?? 0, 0));
  const surcharges = round2(Math.max(input.surcharges ?? 0, 0));
  const waitingCharge = computeWaitingCharge(
    input.waitingSeconds ?? 0,
    input.waitingPolicy,
  );

  // العمولة تُحسب على (الأساس + الانتظار + الرسوم) دون الجسور (تمرّ للسائق).
  const commissionBase = round2(baseComputedFare + waitingCharge + surcharges);
  const grossFare = round2(commissionBase + tolls);

  const commission = round2((commissionBase * input.commissionPct) / 100);
  const driverEarnings = round2(grossFare - commission);

  const coupon = computeCouponDiscount(grossFare, input.coupon);
  const riderPays = round2(grossFare - coupon.discount);
  const driverNet = round2(driverEarnings - coupon.driverFunded);
  const platformNet = round2(commission - coupon.platformFunded);

  return {
    riderPays,
    grossFare,
    commissionBase,
    commission,
    driverEarnings,
    coupon,
    driverNet,
    platformNet,
    components: { baseComputedFare, tolls, waitingCharge, surcharges },
  };
}
