/** دوال جغرافية مساعدة (بدون مكتبات خارجية) */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** المسافة بالكيلومتر بين نقطتين (Haversine) */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** تقدير زمن الرحلة بالثواني بافتراض متوسط سرعة حضرية */
export function estimateDurationSec(
  distanceKm: number,
  avgSpeedKmh = 28,
): number {
  if (distanceKm <= 0) return 0;
  return Math.round((distanceKm / avgSpeedKmh) * 3600);
}
