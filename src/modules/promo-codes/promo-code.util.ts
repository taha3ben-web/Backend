/**
 * منطق نقيّ لرموز الترويج (Promo Codes) — قابل للاختبار بمعزل عن NestJS/Prisma.
 *
 * الرمز الترويجي هنا متمايز عن الكوبون (Coupon):
 * الكوبون = خصم على أجرة رحلة عند الدفع؛ الرمز الترويجي = رصيد ثابت
 * (FIXED) يُضاف إلى محفظة المستخدم عند الاستبدال. لذلك لا يُستبدل إلا نوع FIXED.
 */

export type PromoDiscountType = "PERCENT" | "FIXED";

/** تطبيع الرمز: إزالة الفراغ + تكبير الأحرف. */
export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface PromoRedeemabilityInput {
  isActive: boolean;
  discountType: PromoDiscountType;
  expiresAt: Date | null;
  redeemedCount: number;
  maxRedemptions: number | null;
  now?: Date;
}

export type PromoRedeemability =
  | { ok: true }
  | {
      ok: false;
      reason: "inactive" | "expired" | "not_redeemable_type" | "exhausted";
    };

/**
 * يقيّم قابلية استبدال الرمز (دون اعتبار حدّ المستخدم — يُفرَض بقيد DB فريد):
 * غير نشط -> inactive؛ منتهٍ -> expired؛ نوع غير FIXED -> not_redeemable_type؛
 * بلوغ الحد العالمي -> exhausted؛ خلافه -> ok.
 */
export function evaluatePromoRedeemability(
  input: PromoRedeemabilityInput,
): PromoRedeemability {
  if (!input.isActive) return { ok: false, reason: "inactive" };
  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (input.discountType !== "FIXED") {
    return { ok: false, reason: "not_redeemable_type" };
  }
  if (
    input.maxRedemptions != null &&
    input.redeemedCount >= input.maxRedemptions
  ) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true };
}

/**
 * يحلّ عملة الرمز: يستخدم عملة الرمز إن كانت ISO صالحة، وإلا الافتراضية.
 */
export function resolvePromoCurrency(
  promoCurrency: string | null | undefined,
  defaultCurrency: string,
): string {
  const c = (promoCurrency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : defaultCurrency;
}
