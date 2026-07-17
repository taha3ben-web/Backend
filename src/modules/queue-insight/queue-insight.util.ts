/**
 * منطق نقي لتقييم صحّة الطابور الخلفي (Outbox) — قابل للاختبار دون قاعدة
 * بيانات ولا شبكة. يعمل فوق البنية القائمة (OutboxEvent) دون تكرارها:
 * يشتقّ شدّة الحالة من عمق التراكم (backlog) وتقادم أقدم عنصر معلّق
 * ونسبة رسائل DLQ، ويكتشف التوقّف (stall)، ويحسب حدّ تنظيف السجلات
 * المُسلَّمة (retention). لا يحتوي أي منطق تسعير أو خصم.
 */

export type QueueSeverity = "healthy" | "warning" | "critical";

export interface QueueStatusCounts {
  pending: number;
  failed: number;
  delivered: number;
  dead: number;
}

export interface QueueThresholds {
  /** عدد العناصر المعلّقة (pending+failed) الذي يرفع الحالة إلى تحذير. */
  backlogWarn: number;
  /** عدد العناصر المعلّقة الذي يرفع الحالة إلى حرِجة. */
  backlogCrit: number;
  /** تقادم أقدم عنصر معلّق (مللي ثانية) الذي يرفع إلى تحذير. */
  ageWarnMs: number;
  /** تقادم أقدم عنصر معلّق (مللي ثانية) الذي يرفع إلى حرِجة. */
  ageCritMs: number;
  /** عدد رسائل DLQ الذي يرفع إلى تحذير. */
  deadWarn: number;
  /** عدد رسائل DLQ الذي يرفع إلى حرِجة. */
  deadCrit: number;
  /** نسبة DLQ إلى (delivered+dead) التي تُعدّ غير صحّية. */
  dlqRatioWarn: number;
  /** تقادم أقدم عنصر معلّق الذي يُعتبر عنده الطابور متوقّفًا (stall). */
  stallMs: number;
}

export const DEFAULT_QUEUE_THRESHOLDS: QueueThresholds = {
  backlogWarn: 100,
  backlogCrit: 1_000,
  ageWarnMs: 5 * 60_000,
  ageCritMs: 30 * 60_000,
  deadWarn: 1,
  deadCrit: 25,
  dlqRatioWarn: 0.05,
  stallMs: 5 * 60_000,
};

/** المدّة الافتراضية للاحتفاظ بسجلات DELIVERED قبل التنظيف (أيام). */
export const QUEUE_DEFAULT_RETENTION_DAYS = 14;
/** أدنى مدّة احتفاظ مسموحة — حماية من حذف سجلات حديثة عن طريق الخطأ. */
export const QUEUE_MIN_RETENTION_DAYS = 1;
/** أقصى مدّة احتفاظ مقبولة كمدخل. */
export const QUEUE_MAX_RETENTION_DAYS = 365;

export interface QueueInsightInput {
  counts: QueueStatusCounts;
  /** تقادم أقدم عنصر معلّق بالمللي ثانية، أو null إن لا يوجد. */
  oldestPendingAgeMs: number | null;
}

export interface QueueInsight {
  severity: QueueSeverity;
  /** العناصر التي لم تُسلَّم بعد (pending + failed). */
  backlog: number;
  pending: number;
  failed: number;
  dead: number;
  delivered: number;
  oldestPendingAgeMs: number | null;
  oldestPendingAgeMinutes: number | null;
  /** نسبة DLQ إلى (delivered+dead)، من 0 إلى 1. */
  dlqRatio: number;
  /** true إذا تجاوز أقدم عنصر معلّق عتبة التوقّف. */
  stalled: boolean;
  recommendations: string[];
}

const SEVERITY_RANK: Record<QueueSeverity, number> = {
  healthy: 0,
  warning: 1,
  critical: 2,
};

/** يُرجع الأشدّ بين حالتين. */
export function maxSeverity(a: QueueSeverity, b: QueueSeverity): QueueSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function bandSeverity(
  value: number,
  warn: number,
  crit: number,
): QueueSeverity {
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return "healthy";
}

/** نسبة رسائل DLQ إلى إجمالي ما تمّت معالجته (delivered + dead). */
export function computeDlqRatio(delivered: number, dead: number): number {
  const total = delivered + dead;
  if (total <= 0) return 0;
  return dead / total;
}

/** تحويل المللي ثانية إلى دقائق صحيحة (لأسفل)، أو null. */
export function ageMinutes(ms: number | null): number | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 60_000));
}

/** يقيّد مدّة الاحتفاظ ضمن الحدود المسموحة (عدد أيام صحيح). */
export function clampRetentionDays(days: number | null | undefined): number {
  const raw = Number.isFinite(days as number)
    ? Math.floor(days as number)
    : QUEUE_DEFAULT_RETENTION_DAYS;
  if (raw < QUEUE_MIN_RETENTION_DAYS) return QUEUE_MIN_RETENTION_DAYS;
  if (raw > QUEUE_MAX_RETENTION_DAYS) return QUEUE_MAX_RETENTION_DAYS;
  return raw;
}

/** يحسب لحظة القطع للتنظيف: أي سجلّ مُسلَّم قبلها يُحذف. */
export function retentionCutoff(now: Date, days: number): Date {
  const bounded = clampRetentionDays(days);
  return new Date(now.getTime() - bounded * 24 * 60 * 60 * 1_000);
}

function buildRecommendations(
  insight: Omit<QueueInsight, "recommendations">,
  t: QueueThresholds,
): string[] {
  const out: string[] = [];
  if (insight.stalled) {
    out.push(
      "الطابور متوقّف على ما يبدو: أقدم عنصر معلّق تجاوز عتبة التوقّف — تحقّق من عملية الترحيل (relay).",
    );
  }
  if (insight.backlog >= t.backlogCrit) {
    out.push("تراكم حرِج في الطابور — راقب الاستهلاك وزد الطاقة إن لزم.");
  } else if (insight.backlog >= t.backlogWarn) {
    out.push("تراكم مرتفع في الطابور — راقبه عن كثب.");
  }
  if (insight.dead >= t.deadWarn) {
    out.push(
      "توجد رسائل في DLQ — راجعها ثم أعد جدولتها بعد معالجة سببها الجذري.",
    );
  }
  if (insight.dead > 0 && insight.dlqRatio >= t.dlqRatioWarn) {
    out.push("نسبة رسائل DLQ مرتفعة نسبيًا — تحقّق من صحّة المستهلكين.");
  }
  if (out.length === 0) {
    out.push("الطابور سليم — لا إجراء مطلوب.");
  }
  return out;
}

/**
 * يشتقّ صورة صحّية شاملة للطابور من العدادات وتقادم أقدم عنصر معلّق.
 * الشدّة النهائية = الأشدّ بين شدّة التراكم والتقادم وعدد DLQ ونسبته.
 */
export function classifyQueue(
  input: QueueInsightInput,
  thresholds: QueueThresholds = DEFAULT_QUEUE_THRESHOLDS,
): QueueInsight {
  const t = thresholds;
  const pending = Math.max(0, input.counts.pending);
  const failed = Math.max(0, input.counts.failed);
  const delivered = Math.max(0, input.counts.delivered);
  const dead = Math.max(0, input.counts.dead);
  const backlog = pending + failed;
  const oldestPendingAgeMs = input.oldestPendingAgeMs;
  const dlqRatio = computeDlqRatio(delivered, dead);

  let severity: QueueSeverity = bandSeverity(
    backlog,
    t.backlogWarn,
    t.backlogCrit,
  );
  if (oldestPendingAgeMs !== null) {
    severity = maxSeverity(
      severity,
      bandSeverity(oldestPendingAgeMs, t.ageWarnMs, t.ageCritMs),
    );
  }
  severity = maxSeverity(
    severity,
    bandSeverity(dead, t.deadWarn, t.deadCrit),
  );
  if (dead > 0 && dlqRatio >= t.dlqRatioWarn) {
    severity = maxSeverity(severity, "warning");
  }

  const stalled =
    oldestPendingAgeMs !== null &&
    oldestPendingAgeMs >= t.stallMs &&
    backlog > 0;

  const base: Omit<QueueInsight, "recommendations"> = {
    severity,
    backlog,
    pending,
    failed,
    dead,
    delivered,
    oldestPendingAgeMs,
    oldestPendingAgeMinutes: ageMinutes(oldestPendingAgeMs),
    dlqRatio,
    stalled,
  };

  return { ...base, recommendations: buildRecommendations(base, t) };
}
