/**
 * منطق نقي لأساس المشاركة في الرحلة (Ride Pooling): الاتجاه، توافق
 * راكبين، والانحراف الإضافي فقط. لا يحتوي أي منطق تسعير أو خصم
 * (كل الخصومات تُدار من لوحة التحكم). بلا اعتماد على قاعدة البيانات
 * أو Nest — يعتمد فقط على haversineKm النقية — قابل لاختبارات الوحدة.
 */

import { haversineKm } from "../matching/geo.util";

export interface PoolLeg {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
}

export interface PoolConfig {
  /** أقصى مسافة بين نقطتي الالتقاط (كم). */
  maxPickupDistanceKm: number;
  /** أقصى انحراف إضافي مقبول للمشاركة (كم). */
  maxDetourKm: number;
  /** أقصى فارق اتجاه بين الرحلتين (درجات). */
  directionToleranceDeg: number;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxPickupDistanceKm: 1.5,
  maxDetourKm: 3,
  directionToleranceDeg: 45,
};

export interface PoolCompatibility {
  compatible: boolean;
  pickupDistanceKm: number;
  detourKm: number;
  bearingDiff: number;
  reasons: string[];
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** إحداثيات صالحة جغرافيًا. */
export function isValidLeg(leg: PoolLeg): boolean {
  return (
    isFiniteNumber(leg?.pickupLat) &&
    isFiniteNumber(leg?.pickupLng) &&
    isFiniteNumber(leg?.destLat) &&
    isFiniteNumber(leg?.destLng) &&
    Math.abs(leg.pickupLat) <= 90 &&
    Math.abs(leg.destLat) <= 90 &&
    Math.abs(leg.pickupLng) <= 180 &&
    Math.abs(leg.destLng) <= 180
  );
}

/** زاوية الاتجاه الأولي (0..360) من نقطة إلى أخرى. */
export function bearingDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/** أصغر فارق زاوي بين اتجاهين (0..180). */
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * الانحراف الإضافي (كم) لخدمة الراكبين معًا مقابل ركوبهما منفردين.
 * الترتيب: التقاط A ثم B ثم إنزال A ثم B. يُحصر بحد أدنى 0.
 */
export function pooledExtraKm(a: PoolLeg, b: PoolLeg): number {
  const solo =
    haversineKm(a.pickupLat, a.pickupLng, a.destLat, a.destLng) +
    haversineKm(b.pickupLat, b.pickupLng, b.destLat, b.destLng);
  const pooled =
    haversineKm(a.pickupLat, a.pickupLng, b.pickupLat, b.pickupLng) +
    haversineKm(b.pickupLat, b.pickupLng, a.destLat, a.destLng) +
    haversineKm(a.destLat, a.destLng, b.destLat, b.destLng);
  return Math.max(0, round2(pooled - solo));
}

/** يضمن قيم إعداد صالحة (يستبدل غير الصالح بالافتراضي). */
export function normalizePoolConfig(config: Partial<PoolConfig>): PoolConfig {
  const d = DEFAULT_POOL_CONFIG;
  return {
    maxPickupDistanceKm:
      isFiniteNumber(config.maxPickupDistanceKm) &&
      config.maxPickupDistanceKm > 0
        ? config.maxPickupDistanceKm
        : d.maxPickupDistanceKm,
    maxDetourKm:
      isFiniteNumber(config.maxDetourKm) && config.maxDetourKm >= 0
        ? config.maxDetourKm
        : d.maxDetourKm,
    directionToleranceDeg:
      isFiniteNumber(config.directionToleranceDeg) &&
      config.directionToleranceDeg >= 0 &&
      config.directionToleranceDeg <= 180
        ? config.directionToleranceDeg
        : d.directionToleranceDeg,
  };
}

/** هل يتوافق راكبان للمشاركة؟ يرجع القرار مع المقاييس وأسباب الرفض. */
export function isPoolCompatible(
  a: PoolLeg,
  b: PoolLeg,
  config: Partial<PoolConfig> = DEFAULT_POOL_CONFIG,
): PoolCompatibility {
  const cfg = normalizePoolConfig(config);
  if (!isValidLeg(a) || !isValidLeg(b)) {
    return {
      compatible: false,
      pickupDistanceKm: 0,
      detourKm: 0,
      bearingDiff: 0,
      reasons: ["INVALID_COORDS"],
    };
  }
  const pickupDistanceKm = round2(
    haversineKm(a.pickupLat, a.pickupLng, b.pickupLat, b.pickupLng),
  );
  const bearingDiff = round2(
    angularDiff(
      bearingDeg(a.pickupLat, a.pickupLng, a.destLat, a.destLng),
      bearingDeg(b.pickupLat, b.pickupLng, b.destLat, b.destLng),
    ),
  );
  const detourKm = pooledExtraKm(a, b);
  const reasons: string[] = [];
  if (pickupDistanceKm > cfg.maxPickupDistanceKm) reasons.push("PICKUP_TOO_FAR");
  if (bearingDiff > cfg.directionToleranceDeg) reasons.push("DIFFERENT_DIRECTION");
  if (detourKm > cfg.maxDetourKm) reasons.push("DETOUR_TOO_LONG");
  return {
    compatible: reasons.length === 0,
    pickupDistanceKm,
    detourKm,
    bearingDiff,
    reasons,
  };
}
