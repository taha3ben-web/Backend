/**
 * منطق نقيّ لحماية تسجيل الدخول من هجمات القوة الغاشمة (brute-force).
 * قابل للاختبار بمعزل عن NestJS و Redis.
 */

export interface LoginThrottleConfig {
  /** عدد المحاولات الفاشلة قبل القفل. */
  maxAttempts: number;
  /** نافذة عدّ المحاولات الفاشلة (بالثواني). */
  windowSec: number;
  /** مدة القفل بعد تجاوز الحد (بالثواني). */
  lockSec: number;
}

/** الإعدادات الافتراضية: 5 محاولات / نافذة 15 د / قفل 15 د. */
export const DEFAULT_LOGIN_THROTTLE: LoginThrottleConfig = {
  maxAttempts: 5,
  windowSec: 900,
  lockSec: 900,
};

/** يحوّل قيمة env إلى عدد صحيح مقيّد ضمن [min, max]، وإلا الافتراضي. مُصدَّر لإعادة الاستخدام (مثل otp.util). */
export function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * يقرأ إعدادات الحماية من متغيّرات البيئة مع تقييد القيم (لمنع قيم عبثية).
 * - LOGIN_MAX_ATTEMPTS ∈ [1, 100]
 * - LOGIN_ATTEMPT_WINDOW_SEC ∈ [10, 86400]
 * - LOGIN_LOCK_SEC ∈ [10, 86400]
 */
export function parseLoginThrottleConfig(
  env: Record<string, string | undefined>,
): LoginThrottleConfig {
  return {
    maxAttempts: clampInt(
      env.LOGIN_MAX_ATTEMPTS,
      DEFAULT_LOGIN_THROTTLE.maxAttempts,
      1,
      100,
    ),
    windowSec: clampInt(
      env.LOGIN_ATTEMPT_WINDOW_SEC,
      DEFAULT_LOGIN_THROTTLE.windowSec,
      10,
      86400,
    ),
    lockSec: clampInt(
      env.LOGIN_LOCK_SEC,
      DEFAULT_LOGIN_THROTTLE.lockSec,
      10,
      86400,
    ),
  };
}

/** مفتاح عدّاد المحاولات الفاشلة لهوية (رقم الهاتف المطبّع). */
export function failureKey(identifier: string): string {
  return `auth:login:fail:${identifier}`;
}

/** مفتاح القفل المؤقت لهوية. */
export function lockKey(identifier: string): string {
  return `auth:login:lock:${identifier}`;
}

/** هل يجب القفل الآن؟ (يُستدعى بعد زيادة العدّاد). */
export function shouldLock(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

/** عدد المحاولات المتبقية قبل القفل (لا يقل عن 0). */
export function remainingAttempts(
  attempts: number,
  maxAttempts: number,
): number {
  return Math.max(0, maxAttempts - attempts);
}
