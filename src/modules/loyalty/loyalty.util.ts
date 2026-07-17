/**
 * منطق نقيّ لنظام الولاء (Loyalty) — قابل للاختبار بمعزل عن NestJS/Prisma.
 * لا يعتمد على أي مكتبة خارجية.
 */

export type LoyaltyTierName = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

export interface LoyaltyTierThresholds {
  SILVER: number;
  GOLD: number;
  PLATINUM: number;
}

export interface LoyaltyConfig {
  enabled: boolean;
  /** نقاط تُكسب لكل وحدة عملة (مثلاً 1 نقطة/وحدة). */
  pointsPerCurrencyUnit: number;
  /** عدد النقاط المطلوبة مقابل وحدة عملة واحدة عند الاستبدال. */
  redeemPointsPerUnit: number;
  /** أدنى عدد نقاط قابل للاستبدال. */
  minRedeemPoints: number;
  currency: string;
  tierThresholds: LoyaltyTierThresholds;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  pointsPerCurrencyUnit: 1,
  redeemPointsPerUnit: 100,
  minRedeemPoints: 100,
  currency: "DZD",
  tierThresholds: { SILVER: 1000, GOLD: 5000, PLATINUM: 20000 },
};

type EnvLike = Record<string, string | undefined>;

/** يحسب النقاط المكتسبة من مبلغ (بالوحدات الكبرى). دائمًا عدد صحيح غير سالب. */
export function computeEarnedPoints(
  amountMajor: number,
  pointsPerCurrencyUnit: number,
): number {
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) return 0;
  if (!Number.isFinite(pointsPerCurrencyUnit) || pointsPerCurrencyUnit <= 0) {
    return 0;
  }
  return Math.floor(amountMajor * pointsPerCurrencyUnit);
}

/** يحوّل نقاطًا إلى مبلغ عملة (بالوحدات الكبرى، مدوّر لمنزلتين). */
export function pointsToCurrency(
  points: number,
  redeemPointsPerUnit: number,
): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  if (!Number.isFinite(redeemPointsPerUnit) || redeemPointsPerUnit <= 0) {
    return 0;
  }
  return Math.round((points / redeemPointsPerUnit) * 100) / 100;
}

/** يحدّد فئة الولاء بناءً على النقاط التراكمية. */
export function resolveTier(
  lifetimePoints: number,
  thresholds: LoyaltyTierThresholds = DEFAULT_LOYALTY_CONFIG.tierThresholds,
): LoyaltyTierName {
  const lp = Number.isFinite(lifetimePoints) ? lifetimePoints : 0;
  if (lp >= thresholds.PLATINUM) return "PLATINUM";
  if (lp >= thresholds.GOLD) return "GOLD";
  if (lp >= thresholds.SILVER) return "SILVER";
  return "BRONZE";
}

/** يقرأ إعدادات الولاء من البيئة مع حدود آمنة وقيم افتراضية. */
export function parseLoyaltyConfig(env: EnvLike): LoyaltyConfig {
  const currencyRaw = (
    env.LOYALTY_REWARD_CURRENCY ??
    env.DEFAULT_CURRENCY ??
    DEFAULT_LOYALTY_CONFIG.currency
  )
    .trim()
    .toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw)
    ? currencyRaw
    : DEFAULT_LOYALTY_CONFIG.currency;
  const d = DEFAULT_LOYALTY_CONFIG;
  return {
    enabled: parseBool(env.LOYALTY_ENABLED, d.enabled),
    pointsPerCurrencyUnit: clampNum(
      env.LOYALTY_POINTS_PER_UNIT,
      d.pointsPerCurrencyUnit,
      0,
      1_000_000,
    ),
    redeemPointsPerUnit: clampNum(
      env.LOYALTY_REDEEM_POINTS_PER_UNIT,
      d.redeemPointsPerUnit,
      1,
      1_000_000,
    ),
    minRedeemPoints: Math.trunc(
      clampNum(env.LOYALTY_MIN_REDEEM_POINTS, d.minRedeemPoints, 1, 10_000_000),
    ),
    currency,
    tierThresholds: {
      SILVER: Math.trunc(
        clampNum(env.LOYALTY_TIER_SILVER, d.tierThresholds.SILVER, 1, 1e12),
      ),
      GOLD: Math.trunc(
        clampNum(env.LOYALTY_TIER_GOLD, d.tierThresholds.GOLD, 1, 1e12),
      ),
      PLATINUM: Math.trunc(
        clampNum(env.LOYALTY_TIER_PLATINUM, d.tierThresholds.PLATINUM, 1, 1e12),
      ),
    },
  };
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
