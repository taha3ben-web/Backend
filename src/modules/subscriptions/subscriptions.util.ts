import { round2 } from "../../common/money.util";

/** فواصل تجديد الاشتراك المدعومة. */
export type SubscriptionInterval = "MONTHLY" | "QUARTERLY" | "YEARLY";

/**
 * يحسب نهاية الفترة التالية بإضافة مدّة الفاصل إلى تاريخ البداية.
 * نقية وحتمية (لا تعتمد على الوقت الحالي) لتكون قابلة لاختبار الوحدة.
 */
export function nextPeriodEnd(
  from: Date,
  interval: SubscriptionInterval,
): Date {
  const d = new Date(from.getTime());
  switch (interval) {
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "MONTHLY":
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

export interface PlanBenefit {
  discount: number;
  finalFare: number;
}

/**
 * يحسب خصم منفعة خطة الاشتراك على أجرة رحلة (نسبة مئوية بحدّ أقصى اختياري).
 * data-only: مُعدّ لتستهلكه مراحل التسعير لاحقًا عند تطبيق المنفعة، دون ربطه
 * بمنطق الرحلات في هذه المرحلة (تبقى مستقلة). نقية وحتمية.
 *
 * ضمانات: 0 <= discount <= fare، و discount + finalFare === fare (بعد round2).
 */
export function computePlanBenefit(
  fare: number,
  discountPct: number,
  maxDiscount: number | null | undefined,
): PlanBenefit {
  const safeFare = round2(Math.max(Number(fare) || 0, 0));
  const pct = Math.min(Math.max(Number(discountPct) || 0, 0), 100);
  let discount = round2((safeFare * pct) / 100);
  if (maxDiscount != null && discount > maxDiscount) {
    discount = round2(Math.max(maxDiscount, 0));
  }
  if (discount > safeFare) discount = safeFare;
  return { discount, finalFare: round2(safeFare - discount) };
}
