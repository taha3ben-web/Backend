/**
 * دوال تسعير نقية (بلا اعتماد على قاعدة البيانات) — قابلة لاختبارات الوحدة.
 */

import { round2 } from "../../common/money.util";

export interface FareRuleValues {
  baseFare: number;
  perKm: number;
  perMin: number;
  minFare: number;
  maxFare: number | null;
}

export interface FareComputation {
  fare: number;
  distanceCost: number;
  timeCost: number;
}

/**
 * حساب الأجرة النهائية:
 *   fare = (baseFare + distanceKm*perKm + durationMin*perMin) * peakMultiplier
 * ثم يُحصر ضمن [minFare, maxFare] ويُقرّب إلى منزلتين عشريتين.
 */
export function computeFare(
  rule: FareRuleValues,
  distanceKm: number,
  durationSec: number,
  peakMultiplier: number,
): FareComputation {
  const durationMin = durationSec / 60;
  const distanceCost = distanceKm * rule.perKm;
  const timeCost = durationMin * rule.perMin;

  let fare = (rule.baseFare + distanceCost + timeCost) * peakMultiplier;
  fare = Math.max(fare, rule.minFare);
  if (rule.maxFare != null) fare = Math.min(fare, rule.maxFare);
  fare = round2(fare);

  return {
    fare,
    distanceCost: round2(distanceCost),
    timeCost: round2(timeCost),
  };
}
