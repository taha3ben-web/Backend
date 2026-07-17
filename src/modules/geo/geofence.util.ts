/**
 * أدوات نقيّة للاحتواء الجغرافي (Geofencing) فوق GeoJSON — بلا اعتماديات.
 * ترتيب إحداثيات GeoJSON هو [lng, lat] (الطول ثم العرض).
 * قابلة للاختبار وحدها (tsx) لأنها لا تستورد Nest أو Prisma.
 */

export type LngLat = [number, number];
export type Ring = LngLat[];
export type PolygonCoords = Ring[]; // [حلقة خارجية, ...ثقوب]
export type MultiPolygonCoords = PolygonCoords[];
export type BBox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function isValidLngLat(p: unknown): p is LngLat {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    isFiniteNumber(p[0]) &&
    isFiniteNumber(p[1])
  );
}

/** حدود مستطيلة (bounding box) لحلقة نقاط، أو null إذا لا نقاط صالحة. */
export function ringBBox(ring: Ring): BBox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let count = 0;
  for (const pt of ring) {
    if (!isValidLngLat(pt)) continue;
    const lng = pt[0];
    const lat = pt[1];
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
    count += 1;
  }
  if (count === 0) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function pointInBBox(lng: number, lat: number, box: BBox): boolean {
  return lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
}

/**
 * اختبار احتواء نقطة داخل حلقة مغلقة (خوارزمية ray casting).
 * النقاط بترتيب [lng, lat].
 */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return false;
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!isValidLngLat(a) || !isValidLngLat(b)) continue;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** احتواء داخل مضلّع (الحلقة الأولى خارجية، والباقي ثقوب). */
export function pointInPolygon(
  lng: number,
  lat: number,
  polygon: PolygonCoords,
): boolean {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  const outer = polygon[0];
  if (!Array.isArray(outer) || !pointInRing(lng, lat, outer)) return false;
  for (let h = 1; h < polygon.length; h += 1) {
    if (pointInRing(lng, lat, polygon[h])) return false; // داخل ثقب
  }
  return true;
}

export function pointInMultiPolygon(
  lng: number,
  lat: number,
  mp: MultiPolygonCoords,
): boolean {
  if (!Array.isArray(mp)) return false;
  for (const poly of mp) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

/**
 * احتواء نقطة داخل GeoJSON عام: Geometry (Polygon/MultiPolygon)
 * أو Feature أو FeatureCollection أو GeometryCollection.
 * أي إدخال غير صالح أو نوع غير مدعوم يُعيد false دون رمي استثناء.
 */
export function pointInGeoJson(
  lng: number,
  lat: number,
  geojson: unknown,
): boolean {
  if (!geojson || typeof geojson !== "object") return false;
  const g = geojson as {
    type?: unknown;
    coordinates?: unknown;
    geometry?: unknown;
    geometries?: unknown;
    features?: unknown;
  };
  switch (g.type) {
    case "Polygon":
      return pointInPolygon(lng, lat, (g.coordinates as PolygonCoords) ?? []);
    case "MultiPolygon":
      return pointInMultiPolygon(
        lng,
        lat,
        (g.coordinates as MultiPolygonCoords) ?? [],
      );
    case "Feature":
      return pointInGeoJson(lng, lat, g.geometry);
    case "FeatureCollection":
      return (
        Array.isArray(g.features) &&
        g.features.some((f) => pointInGeoJson(lng, lat, f))
      );
    case "GeometryCollection":
      return (
        Array.isArray(g.geometries) &&
        g.geometries.some((geom) => pointInGeoJson(lng, lat, geom))
      );
    default:
      return false;
  }
}

/** واجهة ملائمة: هل النقطة {lat,lng} داخل GeoJSON؟ */
export function containsPoint(
  geojson: unknown,
  lat: number,
  lng: number,
): boolean {
  return pointInGeoJson(lng, lat, geojson);
}
