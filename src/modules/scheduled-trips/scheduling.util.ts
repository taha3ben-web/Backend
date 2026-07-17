/**
 * منطق نقي لجدولة الرحلات ودعم التوقفات المتعددة (multi-stop).
 * لا يعتمد على قاعدة البيانات — قابل للاختبار بالكامل.
 */

export const MIN_LEAD_MINUTES = 15;
export const MAX_ADVANCE_DAYS = 30;
export const DEFAULT_DISPATCH_LEAD_MINUTES = 10;
export const MAX_STOPS = 5;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface ScheduleValidation {
  valid: boolean;
  reason?: string;
}

/** يتحقّق أنّ وقت الجدولة مستقبلي وضمن نافذة مسموحة. */
export function validateScheduledTime(
  scheduledAtMs: number,
  nowMs: number,
): ScheduleValidation {
  if (!Number.isFinite(scheduledAtMs)) {
    return { valid: false, reason: "INVALID_TIME" };
  }
  const deltaMs = scheduledAtMs - nowMs;
  if (deltaMs < MIN_LEAD_MINUTES * MINUTE_MS) {
    return { valid: false, reason: "TOO_SOON" };
  }
  if (deltaMs > MAX_ADVANCE_DAYS * DAY_MS) {
    return { valid: false, reason: "TOO_FAR" };
  }
  return { valid: true };
}

/** اللحظة التي يجب أن يبدأ فيها البحث عن سائق (قبل الموعد بفترة التمهيد). */
export function dispatchAtMs(
  scheduledAtMs: number,
  leadMinutes: number = DEFAULT_DISPATCH_LEAD_MINUTES,
): number {
  const lead = Math.max(0, Math.floor(leadMinutes));
  return scheduledAtMs - lead * MINUTE_MS;
}

/** هل حان وقت إرسال الرحلة المجدولة إلى محرّك المطابقة؟ */
export function isDueForDispatch(
  dispatchTimeMs: number,
  nowMs: number,
): boolean {
  return nowMs >= dispatchTimeMs;
}

export interface TripStopInput {
  seq: number;
  lat: number;
  lng: number;
  address?: string;
}

/** يتحقّق من صحّة قائمة التوقفات (ترتيب فريد وإحداثيات صالحة). */
export function validateStops(stops: TripStopInput[]): ScheduleValidation {
  if (!Array.isArray(stops) || stops.length === 0) {
    return { valid: false, reason: "NO_STOPS" };
  }
  if (stops.length > MAX_STOPS) {
    return { valid: false, reason: "TOO_MANY_STOPS" };
  }
  const seqs = new Set<number>();
  for (const s of stops) {
    if (!isValidCoord(s.lat, s.lng)) {
      return { valid: false, reason: "INVALID_COORD" };
    }
    if (!Number.isInteger(s.seq) || s.seq < 0) {
      return { valid: false, reason: "INVALID_SEQ" };
    }
    if (seqs.has(s.seq)) {
      return { valid: false, reason: "DUPLICATE_SEQ" };
    }
    seqs.add(s.seq);
  }
  return { valid: true };
}

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** يرتّب التوقفات حسب seq تصاعديًا (نسخة جديدة). */
export function orderStops(stops: TripStopInput[]): TripStopInput[] {
  return [...stops].sort((a, b) => a.seq - b.seq);
}

/** مسافة هافرساين بالكيلومترات بين نقطتين. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** إجمالي مسافة المسار عبر التوقفات المرتّبة (كم). */
export function totalRouteDistanceKm(
  origin: { lat: number; lng: number },
  stops: TripStopInput[],
): number {
  const ordered = orderStops(stops);
  let total = 0;
  let prev = origin;
  for (const s of ordered) {
    total += haversineKm(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return Math.round(total * 1000) / 1000;
}
