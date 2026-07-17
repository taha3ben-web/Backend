/**
 * منطق نقيّ لنظام الإحالة (Referral) — قابل للاختبار بمعزل عن NestJS/Prisma.
 * لا يعتمد إلا على node:crypto.
 */
import { randomInt } from "node:crypto";

// أبجدية خالية من الأحرف الملتبسة (0/O/1/I) لتسهيل المشاركة الشفوية.
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type RandomIntFn = (maxExclusive: number) => number;
const defaultRng: RandomIntFn = (maxExclusive) => randomInt(maxExclusive);

/** تطبيع رمز الإحالة: إزالة الفراغ + تكبير الأحرف. */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * يولّد رمز إحالة عشوائيًا من الأبجدية غير الملتبسة. RNG قابل للحقن للاختبار.
 */
export function generateReferralCode(
  length = 8,
  rng: RandomIntFn = defaultRng,
): string {
  const len = clampInt(length, 8, 4, 16);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += REFERRAL_CODE_ALPHABET[rng(REFERRAL_CODE_ALPHABET.length)];
  }
  return out;
}

export interface ReferralConfig {
  enabled: boolean;
  /** مكافأة المُحيل (بالوحدات الكبرى، مثل 100.00). */
  referrerReward: number;
  /** مكافأة المُحال الجديد. */
  refereeReward: number;
  currency: string;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  enabled: true,
  referrerReward: 100,
  refereeReward: 50,
  currency: "DZD",
};

type EnvLike = Record<string, string | undefined>;

/** يقرأ إعدادات الإحالة من البيئة مع حدود آمنة وقيم افتراضية. */
export function parseReferralConfig(env: EnvLike): ReferralConfig {
  const currencyRaw = (
    env.REFERRAL_REWARD_CURRENCY ??
    env.DEFAULT_CURRENCY ??
    DEFAULT_REFERRAL_CONFIG.currency
  )
    .trim()
    .toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw)
    ? currencyRaw
    : DEFAULT_REFERRAL_CONFIG.currency;
  return {
    enabled: parseBool(env.REFERRAL_ENABLED, DEFAULT_REFERRAL_CONFIG.enabled),
    referrerReward: clampNum(
      env.REFERRAL_REFERRER_REWARD,
      DEFAULT_REFERRAL_CONFIG.referrerReward,
      0,
      1_000_000,
    ),
    refereeReward: clampNum(
      env.REFERRAL_REFEREE_REWARD,
      DEFAULT_REFERRAL_CONFIG.refereeReward,
      0,
      1_000_000,
    ),
    currency,
  };
}

/** هل الإحالة ذاتية (المستخدم يحيل نفسه)؟ */
export function isSelfReferral(referrerId: string, refereeId: string): boolean {
  return referrerId === refereeId;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function clampNum(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function clampInt(
  raw: number,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}
