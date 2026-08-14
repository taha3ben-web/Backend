import { Injectable } from "@nestjs/common";
import {
  GeoDirectionsResult,
  GeoGeocodeResult,
  GeoLatLng,
  GeoPlaceSuggestion,
  GeoProvider,
  GeoProviderContext,
} from "./geo-provider.interface";

interface GooglePrediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface GoogleGeocodeEntry {
  formatted_address: string;
  place_id?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: Array<{ long_name: string; types: string[] }>;
}

/**
 * استجابة Routes API v2 (`:computeRoutes`).
 * الحقول المطلوبة تُحدَّد صراحةً عبر ترويسة X-Goog-FieldMask،
 * وRoutes API يرفض الطلب إن لم تُرسل، لذلك القائمة هنا هي العقد الفعلي.
 */
interface GoogleRoutesV2Route {
  /** بالأمتار. */
  distanceMeters?: number;
  /** نص بصيغة ثوانٍ، مثل "842s". */
  duration?: string;
  polyline?: { encodedPolyline?: string };
}

interface GoogleRoutesV2Response {
  routes?: GoogleRoutesV2Route[];
  error?: { code?: number; message?: string; status?: string };
}

/** نقطة مسار بصيغة Routes API v2. */
function routesWaypoint(point: GeoLatLng) {
  return {
    location: {
      latLng: { latitude: point.lat, longitude: point.lng },
    },
  };
}

/** "842s" → 842. Routes API يعيد المدة كنص Protobuf Duration. */
function parseProtoDurationSeconds(value?: string): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(String(value).replace(/s$/i, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * مزوّد Google Maps.
 *
 * - المسافة والمدة والمسار: **Routes API v2** (`routes.googleapis.com`)
 *   وليس Directions API القديم. هذا هو مصدر الحقيقة الوحيد للمسافة والمدة
 *   في التسعير (المرحلة 7)، وهو ما اعتمده المالك رسميًا بدل OSRM.
 * - الإكمال التلقائي والترميز الجغرافي: Places/Geocoding (خدمات منفصلة عن
 *   Routes API ولا بديل لها داخله).
 *
 * يستخدم المفتاح المُدار من اللوحة (ctx.serverApiKey) — لا مفاتيح مبرمجة صلبًا
 * ولا مفاتيح مخترعة. يرمي Error عند فشل الشبكة، والخدمة تحوّله إلى GEO_PROVIDER_ERROR.
 */
@Injectable()
export class GoogleGeoProvider implements GeoProvider {
  readonly name = "google";
  private readonly base = "https://maps.googleapis.com/maps/api";
  /** Routes API v2 — مستقل تمامًا عن نطاق maps.googleapis.com القديم. */
  private readonly routesBase = "https://routes.googleapis.com";

  private requireKey(ctx: GeoProviderContext): string {
    if (!ctx.serverApiKey) {
      throw new Error("GOOGLE_MAPS_SERVER_KEY_MISSING");
    }
    return ctx.serverApiKey;
  }

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`GOOGLE_HTTP_${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** POST JSON مع ترويسات Routes API (المفتاح + قناع الحقول). */
  private async postRoutes<T>(
    path: string,
    body: unknown,
    key: string,
    fieldMask: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${this.routesBase}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`GOOGLE_ROUTES_HTTP_${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async autocomplete(
    query: string,
    options: { lat?: number; lng?: number; country?: string; limit: number },
    ctx: GeoProviderContext,
  ): Promise<GeoPlaceSuggestion[]> {
    const key = this.requireKey(ctx);
    const params = new URLSearchParams({ input: query, key });
    if (options.country) params.set("components", `country:${options.country}`);
    if (options.lat !== undefined && options.lng !== undefined) {
      params.set("location", `${options.lat},${options.lng}`);
      params.set("radius", "50000");
    }
    const data = await this.getJson<{ predictions?: GooglePrediction[] }>(
      `${this.base}/place/autocomplete/json?${params.toString()}`,
    );
    return (data.predictions ?? []).slice(0, options.limit).map((p) => ({
      placeId: p.place_id,
      primaryText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text,
      description: p.description,
    }));
  }

  async geocode(
    query: string,
    options: { country?: string },
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult[]> {
    const key = this.requireKey(ctx);
    const params = new URLSearchParams({ address: query, key });
    if (options.country) params.set("components", `country:${options.country}`);
    const data = await this.getJson<{ results?: GoogleGeocodeEntry[] }>(
      `${this.base}/geocode/json?${params.toString()}`,
    );
    return (data.results ?? []).map((r) => this.toGeocode(r));
  }

  async reverseGeocode(
    point: GeoLatLng,
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult> {
    const key = this.requireKey(ctx);
    const params = new URLSearchParams({
      latlng: `${point.lat},${point.lng}`,
      key,
    });
    const data = await this.getJson<{ results?: GoogleGeocodeEntry[] }>(
      `${this.base}/geocode/json?${params.toString()}`,
    );
    const first = data.results?.[0];
    if (!first) {
      return {
        address: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
        lat: point.lat,
        lng: point.lng,
      };
    }
    return this.toGeocode(first);
  }

  async directions(
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[],
    ctx: GeoProviderContext,
  ): Promise<GeoDirectionsResult> {
    const key = this.requireKey(ctx);
    // Routes API v2: POST + جسم JSON + قناع حقول إلزامي.
    // لا نطلب أي حقل زائد عن حاجة التسعير (مسافة/مدة/مسار)
    // لأن Google يُسعّر الطلب حسب اتساع قناع الحقول.
    const fieldMask = [
      "routes.distanceMeters",
      "routes.duration",
      "routes.polyline.encodedPolyline",
    ].join(",");
    const body: Record<string, unknown> = {
      origin: routesWaypoint(origin),
      destination: routesWaypoint(destination),
      travelMode: "DRIVE",
      // يأخذ حالة المرور اللحظية بعين الاعتبار — مهم لعدالة سعر الدقيقة.
      routingPreference: "TRAFFIC_AWARE",
      polylineQuality: "OVERVIEW",
      // نطلب مسارًا واحدًا فقط: التسعير لا يحتاج بدائل.
      computeAlternativeRoutes: false,
      languageCode: "ar",
      units: "METRIC",
    };
    if (ctx.defaultCountry) {
      body.regionCode = ctx.defaultCountry.toUpperCase();
    }
    if (waypoints.length) {
      body.intermediates = waypoints.map((w) => routesWaypoint(w));
    }

    const data = await this.postRoutes<GoogleRoutesV2Response>(
      "/directions/v2:computeRoutes",
      body,
      key,
      fieldMask,
    );
    const route = data.routes?.[0];
    if (!route) throw new Error("GOOGLE_NO_ROUTE");
    const distanceMeters = Math.max(Number(route.distanceMeters ?? 0), 0);
    const durationSeconds = parseProtoDurationSeconds(route.duration);
    if (distanceMeters <= 0 || durationSeconds <= 0) {
      // لا نُرجع مسارًا بقيم صفرية — ذلك ينتج أجرة خاطئة صامتة.
      throw new Error("GOOGLE_NO_ROUTE");
    }
    return {
      distanceMeters,
      durationSeconds,
      polyline: route.polyline?.encodedPolyline ?? "",
      provider: this.name,
      approximate: false,
    };
  }

  private toGeocode(entry: GoogleGeocodeEntry): GeoGeocodeResult {
    const country = entry.address_components?.find((c) =>
      c.types.includes("country"),
    )?.long_name;
    const city = entry.address_components?.find(
      (c) =>
        c.types.includes("locality") ||
        c.types.includes("administrative_area_level_2"),
    )?.long_name;
    return {
      address: entry.formatted_address,
      lat: entry.geometry?.location?.lat ?? 0,
      lng: entry.geometry?.location?.lng ?? 0,
      placeId: entry.place_id,
      country,
      city,
    };
  }
}
