/**
 * منطق نقي لحساب مضاعف التسعير الديناميكي (Surge) من الطلب/العرض اللحظي.
 * بلا اعتماد على قاعدة البيانات أو Nest — قابل لاختبارات الوحدة.
 */

export interface SurgeConfig {
  /** نسبة الطلب/العرض التي يبدأ عندها التصاعد (أقل منها = بلا surge). */
  threshold: number;
  /** حساسية التصاعد: كم يرتفع المضاعف لكل وحدة تجاوز فوق العتبة. */
  sensitivity: number;
  /** الحد الأقصى للمضاعف قبل سقف المدينة (surgeCap). */
  maxMultiplier: number;
  /** خطوة التقريب (مثل 0.1 => 1.0, 1.1, 1.2 ...). */
  step: number;
  /** أدنى عدد طلبات نشطة لتفعيل الـ surge (يمنع الضجيج على أحجام صغيرة). */
  minDemand: number;
}

export const DEFAULT_SURGE_CONFIG: SurgeConfig = {
  threshold: 1,
  sensitivity: 0.5,
  maxMultiplier: 3,
  step: 0.1,
  minDemand: 3,
};

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** يضمن قيم إعداد صالحة (يستبدل غير الصالح بالافتراضي). */
export function normalizeConfig(config: Partial<SurgeConfig>): SurgeConfig {
  const d = DEFAULT_SURGE_CONFIG;
  return {
    threshold:
      isFiniteNumber(config.threshold) && config.threshold >= 0
        ? config.threshold
        : d.threshold,
    sensitivity:
      isFiniteNumber(config.sensitivity) && config.sensitivity >= 0
        ? config.sensitivity
        : d.sensitivity,
    maxMultiplier:
      isFiniteNumber(config.maxMultiplier) && config.maxMultiplier >= 1
        ? config.maxMultiplier
        : d.maxMultiplier,
    step:
      isFiniteNumber(config.step) && config.step > 0 ? config.step : d.step,
    minDemand:
      isFiniteNumber(config.minDemand) && config.minDemand >= 0
        ? config.minDemand
        : d.minDemand,
  };
}

/** نسبة الطلب إلى العرض (العرض يُحصر بحد أدنى 1 لتفادي القسمة على صفر). */
export function demandSupplyRatio(demand: number, supply: number): number {
  const d = isFiniteNumber(demand) && demand > 0 ? demand : 0;
  const s = isFiniteNumber(supply) && supply > 0 ? supply : 0;
  return d / Math.max(s, 1);
}

/** تقريب لأقرب خطوة (step) مع تفادي أخطاء الفاصلة العائمة. */
export function roundToStep(value: number, step: number): number {
  if (!isFiniteNumber(value)) return 1;
  if (!isFiniteNumber(step) || step <= 0) return value;
  const rounded = Math.round(value / step) * step;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(rounded.toFixed(decimals));
}

/**
 * يحسب مضاعف الـ surge من الطلب/العرض:
 *   ratio = demand / max(supply, 1)
 *   raw   = 1 + sensitivity * max(0, ratio - threshold)
 * ثم يُحصر ضمن [1, maxMultiplier] ويُقرّب إلى step.
 * يرجع 1 (بلا surge) إن كان الطلب دون minDemand أو المدخلات غير صالحة.
 */
export function computeSurgeMultiplier(
  demand: number,
  supply: number,
  config: Partial<SurgeConfig> = DEFAULT_SURGE_CONFIG,
): number {
  const cfg = normalizeConfig(config);
  if (!isFiniteNumber(demand) || demand < cfg.minDemand) return 1;
  const ratio = demandSupplyRatio(demand, supply);
  const excess = Math.max(0, ratio - cfg.threshold);
  const raw = 1 + cfg.sensitivity * excess;
  const capped = Math.min(Math.max(raw, 1), cfg.maxMultiplier);
  return Math.max(1, roundToStep(capped, cfg.step));
}
