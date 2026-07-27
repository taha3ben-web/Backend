/**
 * تجريد مزوّد الخرائط (Maps Provider Abstraction).
 *
 * كل مزوّد (Google / Mapbox / داخلي) يُنفّذ هذه الواجهة خلف الباكند،
 * فلا تعرف التطبيقات أي مزوّد مستخدم ولا تحمل أي مفاتيح.
 */

export interface GeoLatLng {
  lat: number;
  lng: number;
}

export interface GeoPlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText?: string;
  description: string;
  lat?: number;
  lng?: number;
}

export interface GeoGeocodeResult {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  country?: string;
  city?: string;
}

export interface GeoDirectionsResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  /** تقريبي: هل حُسب محليًا (داخلي) أم من مزوّد خارجي. */
  provider: string;
  approximate: boolean;
}

export interface GeoProviderContext {
  provider: string;
  serverApiKey?: string;
  defaultCountry?: string;
  averageSpeedKmh: number;
  /** عنوان قاعدة الخدمة للمزوّدين المستضافين ذاتيًا (OSRM). */
  baseUrl?: string;
}

export interface GeoProvider {
  readonly name: string;
  autocomplete(
    query: string,
    options: { lat?: number; lng?: number; country?: string; limit: number },
    ctx: GeoProviderContext,
  ): Promise<GeoPlaceSuggestion[]>;
  geocode(
    query: string,
    options: { country?: string },
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult[]>;
  reverseGeocode(
    point: GeoLatLng,
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult>;
  directions(
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[],
    ctx: GeoProviderContext,
  ): Promise<GeoDirectionsResult>;
}
