import { Injectable, Logger } from "@nestjs/common";
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

interface GoogleDirectionsLeg {
  distance?: { value: number };
  duration?: { value: number };
}

interface GoogleDirectionsRoute {
  legs?: GoogleDirectionsLeg[];
  overview_polyline?: { points?: string };
}

/**
 * مزوّد Google Maps (Places + Geocoding + Directions).
 *
 * يستخدم المفتاح المُدار من اللوحة (ctx.serverApiKey) — لا مفاتيح مبرمجة صلبًا.
 * يرمي Error عند فشل الشبكة، والخدمة تحوّله إلى GEO_PROVIDER_ERROR.
 */
@Injectable()
export class GoogleGeoProvider implements GeoProvider {
  readonly name = "google";
  private readonly logger = new Logger(GoogleGeoProvider.name);
  private readonly base = "https://maps.googleapis.com/maps/api";

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
    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      key,
    });
    if (waypoints.length) {
      params.set(
        "waypoints",
        waypoints.map((w) => `${w.lat},${w.lng}`).join("|"),
      );
    }
    const data = await this.getJson<{ routes?: GoogleDirectionsRoute[] }>(
      `${this.base}/directions/json?${params.toString()}`,
    );
    const route = data.routes?.[0];
    if (!route) throw new Error("GOOGLE_NO_ROUTE");
    const distanceMeters = (route.legs ?? []).reduce(
      (sum, leg) => sum + (leg.distance?.value ?? 0),
      0,
    );
    const durationSeconds = (route.legs ?? []).reduce(
      (sum, leg) => sum + (leg.duration?.value ?? 0),
      0,
    );
    return {
      distanceMeters,
      durationSeconds,
      polyline: route.overview_polyline?.points ?? "",
      provider: this.name,
      approximate: false,
    };
  }

  private toGeocode(entry: GoogleGeocodeEntry): GeoGeocodeResult {
    const country = entry.address_components?.find((c) =>
      c.types.includes("country"),
    )?.long_name;
    const city = entry.address_components?.find(
      (c) => c.types.includes("locality") || c.types.includes("administrative_area_level_2"),
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
