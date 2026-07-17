/**
 * منطق نقي للقفل الموزّع (Distributed Lock) — قابل للاختبار دون Redis.
 * يحدّد مفتاح القفل، وتراجع إعادة المحاولة (أسّي مسقوف)، وإضافة jitter.
 */

export const LOCK_DEFAULT_TTL_MS = 10_000;
export const LOCK_DEFAULT_TIMEOUT_MS = 3_000;
export const LOCK_RETRY_BASE_MS = 50;
export const LOCK_RETRY_MAX_MS = 400;
export const LOCK_KEY_PREFIX = "lock:";

/** مفتاح القفل في Redis (ببادئة موحّدة). */
export function lockKey(name: string): string {
  return `${LOCK_KEY_PREFIX}${name}`;
}

/**
 * تراجع أسّي مسقوف: base * 2^(attempt-1) محدودًا بـ max.
 * attempt هو رقم إعادة المحاولة (1 = أول إعادة).
 */
export function lockBackoffMs(
  attempt: number,
  baseMs: number = LOCK_RETRY_BASE_MS,
  maxMs: number = LOCK_RETRY_MAX_MS,
): number {
  if (attempt <= 0) return 0;
  const exponential = baseMs * Math.pow(2, attempt - 1);
  return Math.min(exponential, maxMs);
}

/**
 * jitter كامل: يُرجع قيمة في المدى [ms/2, ms] لتفريق محاولات الطالبين.
 * rand قابلة للحقن لأغراض الاختبار.
 */
export function withJitter(ms: number, rand: () => number = Math.random): number {
  if (ms <= 0) return 0;
  const half = ms / 2;
  return Math.round(half + rand() * half);
}

/**
 * سكربت Lua لإطلاق القفل بأمان: يحذف المفتاح فقط إذا طابق الرمز
 * (منع حذف قفل مالك آخر بعد انتهاء TTL).
 */
export const LOCK_RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
