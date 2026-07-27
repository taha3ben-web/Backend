import type { GeoLatLng } from "./providers/geo-provider.interface";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** المسافة بالأمتار بين نقطتين (Haversine). */
export function haversineMeters(a: GeoLatLng, b: GeoLatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** طول مسار متعدد النقاط بالأمتار. */
export function pathLengthMeters(points: GeoLatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

/**
 * ترميز Google Encoded Polyline Algorithm Format (precision 5).
 * متوافق مع مكتبات فكّ الترميز في التطبيقات.
 */
export function encodePolyline(points: GeoLatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";

  const encode = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);
    return chunk;
  };

  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    result += encode(lat - lastLat);
    result += encode(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

/**
 * فكّ ترميز Google Encoded Polyline (precision 5) — عكس `encodePolyline`.
 * دالة نقية تمامًا: تُرجع مصفوفة فارغة عند أي مدخل غير صالح.
 */
export function decodePolyline(encoded: string): GeoLatLng[] {
  if (typeof encoded !== "string" || encoded.length === 0) return [];
  const points: GeoLatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = nextValue();
    if (dLat === null) break;
    const dLng = nextValue();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * أقصر مسافة (أمتار) بين نقطة وقطعة مستقيمة بين نقطتين.
 * إسقاط مستوٍ موضعي (دقيق بما يكفي لمسافات قصيرة).
 */
export function distanceToSegmentMeters(
  point: GeoLatLng,
  a: GeoLatLng,
  b: GeoLatLng,
): number {
  const latRad = (point.lat * Math.PI) / 180;
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.max(0.01, Math.cos(latRad));
  const px = (point.lng - a.lng) * mPerDegLng;
  const py = (point.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * أقصر مسافة (أمتار) بين نقطة ومسار كامل.
 * يُرجع `Infinity` إن كان المسار فارغًا (لا يمكن الحكم).
 */
export function distanceToPathMeters(
  point: GeoLatLng,
  path: GeoLatLng[],
): number {
  if (!Array.isArray(path) || path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters(point, path[0]);
  let min = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    const d = distanceToSegmentMeters(point, path[i - 1], path[i]);
    if (d < min) min = d;
  }
  return min;
}

/** يولّد مسارًا تقريبيًا (خط مستقيم مجزّأ) بين نقاط. */
export function interpolatePath(
  points: GeoLatLng[],
  segments = 12,
): GeoLatLng[] {
  if (points.length < 2) return points;
  const path: GeoLatLng[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    for (let s = 0; s < segments; s += 1) {
      const t = s / segments;
      path.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      });
    }
  }
  path.push(points[points.length - 1]);
  return path;
}
