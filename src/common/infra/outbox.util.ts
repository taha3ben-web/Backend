/**
 * منطق نقي لحالة صندوق الصادر (Outbox) — قابل للاختبار دون قاعدة بيانات.
 * يحدّد سياسة إعادة المحاولة (تراجع أسّي مع سقف) والانتقال إلى DLQ.
 */

export const OUTBOX_MAX_ATTEMPTS = 10;
/** التأخير الأساسي قبل أول إعادة محاولة (بالمللي ثانية). */
export const OUTBOX_BASE_DELAY_MS = 5_000;
/** الحد الأعلى للتأخير بين المحاولات (ساعة واحدة). */
export const OUTBOX_MAX_DELAY_MS = 60 * 60 * 1_000;

/**
 * تراجع أسّي مع سقف: base * 2^(attempts-1) محدودًا بـ maxMs.
 * attempts هو رقم المحاولة القادمة (1 = أول إعادة محاولة).
 */
export function computeBackoffMs(
  attempts: number,
  baseMs: number = OUTBOX_BASE_DELAY_MS,
  maxMs: number = OUTBOX_MAX_DELAY_MS,
): number {
  if (attempts <= 0) return 0;
  const exponential = baseMs * Math.pow(2, attempts - 1);
  return Math.min(exponential, maxMs);
}

export type OutboxTransitionStatus = "DELIVERED" | "FAILED" | "DEAD";

export interface OutboxTransition {
  status: OutboxTransitionStatus;
  attempts: number;
  availableAt: Date;
  lastError: string | null;
  deliveredAt: Date | null;
}

/**
 * يحسب الحالة التالية لسجل الصندوق بعد محاولة تسليم:
 * - نجاح → DELIVERED.
 * - فشل وبلوغ maxAttempts → DEAD (ينتقل إلى DLQ).
 * - فشل دون بلوغ الحد → FAILED مع موعد إتاحة مؤجّل (تراجع أسّي).
 */
export function nextOutboxState(args: {
  success: boolean;
  attempts: number;
  maxAttempts?: number;
  error?: string | null;
  now?: Date;
  baseMs?: number;
  maxMs?: number;
}): OutboxTransition {
  const now = args.now ?? new Date();
  const maxAttempts = args.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  if (args.success) {
    return {
      status: "DELIVERED",
      attempts: args.attempts + 1,
      availableAt: now,
      lastError: null,
      deliveredAt: now,
    };
  }

  const attempts = args.attempts + 1;
  const lastError = (args.error ?? "unknown error").slice(0, 500);

  if (attempts >= maxAttempts) {
    return {
      status: "DEAD",
      attempts,
      availableAt: now,
      lastError,
      deliveredAt: null,
    };
  }

  const delayMs = computeBackoffMs(attempts, args.baseMs, args.maxMs);
  return {
    status: "FAILED",
    attempts,
    availableAt: new Date(now.getTime() + delayMs),
    lastError,
    deliveredAt: null,
  };
}
