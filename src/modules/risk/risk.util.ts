/**
 * طبقة نقية لمحرّك المخاطر والاحتيال (Fraud & Risk) — بلا اعتماد على
 * قاعدة البيانات أو أي مكتبة خارجية، قابلة لاختبارات الوحدة.
 *
 * الهدف (P1): محرّك مخاطر موحّد يحسب نتيجة (score) وقرارًا (ALLOW/REVIEW/
 * BLOCK) من إشارات متعدّدة: حدود السرعة (velocity)، شذوذ المبلغ، جهاز
 * جديد، وجود في قائمة حظر،… الخ. تُستهلك من `RiskService`.
 */

/** قرار المخاطر النهائي. */
export type RiskDecision = "ALLOW" | "REVIEW" | "BLOCK";

/** مستوى المخاطرة المشتقّ من النتيجة. */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** سبب مساهِم في النتيجة (للشفافية والتدقيق). */
export interface RiskReason {
  code: string;
  weight: number;
  detail?: string;
}

/** حدود السرعة لنافذة زمنية معيّنة. */
export interface VelocityLimit {
  windowMs: number;
  maxCount: number;
  maxAmount?: number;
}

/** حدث سابق يُستخدم في حساب السرعة. */
export interface RiskEventPoint {
  at: number;
  amount?: number;
}

/** نتيجة فحص السرعة. */
export interface VelocityResult {
  exceeded: boolean;
  count: number;
  amount: number;
  reason?: RiskReason;
}

/** عتبات القرار الافتراضية. */
export const DEFAULT_REVIEW_THRESHOLD = 40;
export const DEFAULT_BLOCK_THRESHOLD = 70;

/**
 * فحص حد السرعة: يعدّ الأحداث داخل النافذة الزمنية (نسبةً إلى `now`)
 * ويجمع مبالغها، ثم يقارن بالحدود. الحدث الحالي مشمول عبر `pending`.
 */
export function checkVelocity(
  history: RiskEventPoint[],
  limit: VelocityLimit,
  now: number,
  pending?: RiskEventPoint,
): VelocityResult {
  const windowStart = now - limit.windowMs;
  const inWindow = history.filter((e) => e.at >= windowStart && e.at <= now);
  if (pending) inWindow.push(pending);

  const count = inWindow.length;
  const amount = inWindow.reduce((s, e) => s + (e.amount ?? 0), 0);

  const countExceeded = count > limit.maxCount;
  const amountExceeded =
    limit.maxAmount !== undefined && amount > limit.maxAmount;
  const exceeded = countExceeded || amountExceeded;

  let reason: RiskReason | undefined;
  if (exceeded) {
    reason = {
      code: countExceeded ? "VELOCITY_COUNT" : "VELOCITY_AMOUNT",
      weight: 35,
      detail: countExceeded
        ? `count ${count} > ${limit.maxCount}`
        : `amount ${amount} > ${limit.maxAmount}`,
    };
  }
  return { exceeded, count, amount, reason };
}

/**
 * درجة شذوذ المبلغ مقارنةً بالمتوسّط التاريخي. تُعيد مضاعف الانحراف
 * (كم ضعفًا يتجاوز المتوسّط). قيمة ≤ 1 تعني لا شذوذ.
 */
export function amountAnomalyRatio(amount: number, avgAmount: number): number {
  if (!Number.isFinite(avgAmount) || avgAmount <= 0) return 1;
  return amount / avgAmount;
}

/** مدخلات تقييم المخاطر الشامل. */
export interface RiskAssessmentInput {
  amount?: number;
  avgAmount?: number;
  velocity?: VelocityResult;
  isNewDevice?: boolean;
  isNewAccount?: boolean;
  blacklisted?: boolean;
  hasActiveHold?: boolean;
  chargebackCount?: number;
  reviewThreshold?: number;
  blockThreshold?: number;
}

/** نتيجة تقييم المخاطر. */
export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  decision: RiskDecision;
  reasons: RiskReason[];
}

/** تحويل نتيجة رقمية (0–100) إلى مستوى. */
export function scoreToLevel(score: number): RiskLevel {
  if (score >= DEFAULT_BLOCK_THRESHOLD) return "HIGH";
  if (score >= DEFAULT_REVIEW_THRESHOLD) return "MEDIUM";
  return "LOW";
}

/**
 * تقييم المخاطر الشامل: يجمع أوزان الإشارات إلى نتيجة محصورة [0,100]
 * ثم يحوّلها إلى قرار حسب العتبات. وجود في قائمة حظر أو حجز نشط
 * يفرض BLOCK مباشرةً (short-circuit).
 */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const reviewThreshold = input.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  const blockThreshold = input.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
  const reasons: RiskReason[] = [];

  // حظر قطعي: قائمة حظر أو حجز نشط.
  if (input.blacklisted) {
    reasons.push({ code: "BLACKLISTED", weight: 100 });
    return { score: 100, level: "HIGH", decision: "BLOCK", reasons };
  }
  if (input.hasActiveHold) {
    reasons.push({ code: "ACTIVE_HOLD", weight: 100 });
    return { score: 100, level: "HIGH", decision: "BLOCK", reasons };
  }

  let score = 0;

  if (input.velocity?.exceeded && input.velocity.reason) {
    reasons.push(input.velocity.reason);
    score += input.velocity.reason.weight;
  }

  if (input.amount !== undefined && input.avgAmount) {
    const ratio = amountAnomalyRatio(input.amount, input.avgAmount);
    if (ratio >= 5) {
      reasons.push({
        code: "AMOUNT_ANOMALY",
        weight: 30,
        detail: `x${ratio.toFixed(1)} avg`,
      });
      score += 30;
    } else if (ratio >= 3) {
      reasons.push({
        code: "AMOUNT_ELEVATED",
        weight: 15,
        detail: `x${ratio.toFixed(1)} avg`,
      });
      score += 15;
    }
  }

  if (input.isNewDevice) {
    reasons.push({ code: "NEW_DEVICE", weight: 15 });
    score += 15;
  }
  if (input.isNewAccount) {
    reasons.push({ code: "NEW_ACCOUNT", weight: 10 });
    score += 10;
  }
  if (input.chargebackCount && input.chargebackCount > 0) {
    const w = Math.min(40, input.chargebackCount * 20);
    reasons.push({
      code: "CHARGEBACK_HISTORY",
      weight: w,
      detail: `${input.chargebackCount} chargebacks`,
    });
    score += w;
  }

  score = Math.max(0, Math.min(100, score));

  let decision: RiskDecision = "ALLOW";
  if (score >= blockThreshold) decision = "BLOCK";
  else if (score >= reviewThreshold) decision = "REVIEW";

  return { score, level: scoreToLevel(score), decision, reasons };
}

/** تطبيع قيمة قائمة الحظر (trim + توحيد حالة الأحرف للمقارنة). */
export function normalizeBlacklistValue(value: string): string {
  return (value || "").trim().toLowerCase();
}
