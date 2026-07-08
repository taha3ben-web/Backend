/**
 * تسوية الرحلة ماليًا (دالة نقية) — عمولة الشركة وصافي السائق.
 * قابلة لاختبارات الوحدة دون قاعدة بيانات.
 */

import { round2 } from "../../common/money.util";

export interface Settlement {
  gross: number;
  commission: number;
  net: number;
}

/**
 * @param fare أجرة الرحلة الإجمالية.
 * @param commissionRate نسبة عمولة الشركة (مثال 0.15 = 15%).
 * تُقرّب العمولة والصافي إلى منزلتين عشريتين.
 */
export function computeSettlement(
  fare: number,
  commissionRate: number,
): Settlement {
  const gross = round2(fare);
  const commission = round2(gross * commissionRate);
  const net = round2(gross - commission);
  return { gross, commission, net };
}
