/**
 * منطق نقيّ لرموز OTP (التحقق لمرة واحدة) — قابل للاختبار بمعزل عن NestJS/Redis.
 * يعتمد فقط على node:crypto (لا حزم خارجية)، ويحدّد:
 * توليد الرمز، تجزئته (لعدم تخزينه نصًّا صريحًا)، مقارنة ثابتة الزمن،
 * إعدادات قابلة للضبط عبر env، ومفاتيح Redis، وقرار التحقق.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { clampInt } from "./login-throttle.util";

/** أغراض الرمز (تفصل نطاقات الاستخدام ومفاتيح Redis). */
export type OtpPurpose = "PHONE_VERIFICATION" | "LOGIN" | "PASSWORD_RESET";

export const OTP_PURPOSES: readonly OtpPurpose[] = [
  "PHONE_VERIFICATION",
  "LOGIN",
  "PASSWORD_RESET",
];

export function isOtpPurpose(value: unknown): value is OtpPurpose {
  return (
    typeof value === "string" &&
    (OTP_PURPOSES as readonly string[]).includes(value)
  );
}

/** يدعم قيمة غير معروفة ويرجع للافتراضي عند عدم المطابقة. */
export function normalizePurpose(value: unknown): OtpPurpose {
  return isOtpPurpose(value) ? value : "PHONE_VERIFICATION";
}

export interface OtpConfig {
  /** طول الرمز الرقمي. */
  codeLength: number;
  /** مدة صلاحية الرمز (بالثواني). */
  ttlSec: number;
  /** أقصى محاولات تحقق خاطئة قبل إبطال الرمز. */
  maxVerifyAttempts: number;
  /** نافذة تقييد طلبات الإرسال (بالثواني). */
  requestWindowSec: number;
  /** أقصى عدد طلبات إرسال ضمن النافذة. */
  maxRequestsPerWindow: number;
}

/** افتراضيات آمنة: رمز 6 أرقام / 5 دقائق / 5 محاولات / 5 طلبات في الساعة. */
export const DEFAULT_OTP_CONFIG: OtpConfig = {
  codeLength: 6,
  ttlSec: 300,
  maxVerifyAttempts: 5,
  requestWindowSec: 3600,
  maxRequestsPerWindow: 5,
};

/**
 * يقرأ إعدادات OTP من env مع تقييد القيم (منع قيم عبثية):
 * - OTP_CODE_LENGTH ∈ [4, 8]
 * - OTP_TTL_SEC ∈ [30, 3600]
 * - OTP_MAX_VERIFY_ATTEMPTS ∈ [1, 20]
 * - OTP_REQUEST_WINDOW_SEC ∈ [60, 86400]
 * - OTP_MAX_REQUESTS_PER_WINDOW ∈ [1, 100]
 */
export function parseOtpConfig(
  env: Record<string, string | undefined>,
): OtpConfig {
  return {
    codeLength: clampInt(env.OTP_CODE_LENGTH, DEFAULT_OTP_CONFIG.codeLength, 4, 8),
    ttlSec: clampInt(env.OTP_TTL_SEC, DEFAULT_OTP_CONFIG.ttlSec, 30, 3600),
    maxVerifyAttempts: clampInt(
      env.OTP_MAX_VERIFY_ATTEMPTS,
      DEFAULT_OTP_CONFIG.maxVerifyAttempts,
      1,
      20,
    ),
    requestWindowSec: clampInt(
      env.OTP_REQUEST_WINDOW_SEC,
      DEFAULT_OTP_CONFIG.requestWindowSec,
      60,
      86400,
    ),
    maxRequestsPerWindow: clampInt(
      env.OTP_MAX_REQUESTS_PER_WINDOW,
      DEFAULT_OTP_CONFIG.maxRequestsPerWindow,
      1,
      100,
    ),
  };
}

/**
 * يولّد رمزًا رقميًا بطول محدّد. يقبل دالة عشوائية قابلة للحقن للاختبار؛
 * الافتراضي randomInt من node:crypto (قوي تشفيريًا). قد يبدأ بصفر (مقبول).
 */
export function generateOtpCode(
  length: number,
  rng: (maxExclusive: number) => number = (maxExclusive) =>
    randomInt(maxExclusive),
): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String(rng(10));
  }
  return out;
}

/**
 * يجزّئ الرمز مربوطًا بالهوية (رقم الهاتف) + pepper عبر HMAC-SHA256،
 * لأن تخزين الرمز نصًّا صريحًا في Redis خطر (تسرّب = انتحال جميع الرموز).
 */
export function hashOtp(
  code: string,
  identifier: string,
  pepper: string,
): string {
  return createHmac("sha256", pepper)
    .update(`${identifier}:${code}`)
    .digest("hex");
}

/** مقارنة ثابتة الزمن للتجزئات (تمنع timing attacks). */
export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------- مفاتيح Redis ----------

export function otpKey(purpose: OtpPurpose, identifier: string): string {
  return `auth:otp:${purpose}:${identifier}`;
}

export function otpRequestCountKey(
  purpose: OtpPurpose,
  identifier: string,
): string {
  return `auth:otp:req:${purpose}:${identifier}`;
}

export function otpVerifiedKey(
  purpose: OtpPurpose,
  identifier: string,
): string {
  return `auth:otp:verified:${purpose}:${identifier}`;
}

// ---------- سجل الرمز المخزّن ----------

export interface OtpRecord {
  hash: string;
  attempts: number;
}

export function serializeOtpRecord(record: OtpRecord): string {
  return JSON.stringify({ hash: record.hash, attempts: record.attempts });
}

/** تحليل آمن: يرجع null عند الغياب أو التلف. */
export function parseOtpRecord(raw: string | null | undefined): OtpRecord | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { hash?: unknown; attempts?: unknown };
    if (typeof obj.hash !== "string") return null;
    const attempts =
      typeof obj.attempts === "number" && Number.isFinite(obj.attempts)
        ? obj.attempts
        : 0;
    return { hash: obj.hash, attempts };
  } catch {
    return null;
  }
}

// ---------- قرار التحقق ----------

export type OtpVerifyOutcome =
  | { status: "not_found" }
  | { status: "exhausted" }
  | { status: "mismatch"; nextAttempts: number; remainingAttempts: number }
  | { status: "match" };

/**
 * يقيّم محاولة تحقق بناءً على السجل المخزّن وتجزئة الرمز المُدخَل:
 * - لا سجل -> not_found (منتهٍ أو غير موجود).
 * - تجاوز المحاولات -> exhausted.
 * - تطابق -> match. خلافه -> mismatch مع المحاولات المتبقية.
 */
export function evaluateOtpVerification(
  record: OtpRecord | null,
  providedHash: string,
  maxVerifyAttempts: number,
): OtpVerifyOutcome {
  if (!record) return { status: "not_found" };
  if (record.attempts >= maxVerifyAttempts) return { status: "exhausted" };
  if (constantTimeEquals(record.hash, providedHash)) return { status: "match" };
  const nextAttempts = record.attempts + 1;
  const remainingAttempts = Math.max(0, maxVerifyAttempts - nextAttempts);
  return { status: "mismatch", nextAttempts, remainingAttempts };
}
