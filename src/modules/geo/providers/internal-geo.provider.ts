import { Injectable } from "@nestjs/common";
import {
  GeoDirectionsResult,
  GeoGeocodeResult,
  GeoLatLng,
  GeoPlaceSuggestion,
  GeoProvider,
  GeoProviderContext,
} from "./geo-provider.interface";
import { encodePolyline, interpolatePath, pathLengthMeters } from "../geo.util";

/**
 * مزوّد داخلي (Offline) يعمل دون شبكة ودون مفاتيح.
 *
 * - directions: يحسب المسافة بـ Haversine والزمن بمتوسط سرعة قابل للضبط،
 *   ويولّد polyline تقريبيًا. يُعدّ مرجع الأمان دائمًا.
 * - autocomplete/geocode/reverse: ترجع نتائج منظّمة من المدخل،
 *   حتى تبقى الواجهة مستقرة إذا لم يُضبط مزوّد خارجي.
 */
@Injectable()
export class InternalGeoProvider implements GeoProvider {
  readonly name = "internal";

  async autocomplete(
    query: string,
    options: { lat?: number; lng?: number; country?: string; limit: number },
  ): Promise<GeoPlaceSuggestion[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const coord = this.parseCoordinate(trimmed);
    if (coord) {
      return [
        {
          placeId: `internal:${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`,
          primaryText: trimmed,
          secondaryText: options.country,
          description: trimmed,
          lat: coord.lat,
          lng: coord.lng,
        },
      ];
    }
    return [
      {
        placeId: `internal:q:${encodeURIComponent(trimmed)}`,
        primaryText: trimmed,
        secondaryText: options.country,
        description: options.country
          ? `${trimmed}, ${options.country}`
          : trimmed,
        lat: options.lat,
        lng: options.lng,
      },
    ];
  }

  async geocode(
    query: string,
    options: { country?: string },
  ): Promise<GeoGeocodeResult[]> {
    const coord = this.parseCoordinate(query);
    if (!coord) return [];
    return [
      {
        address: query.trim(),
        lat: coord.lat,
        lng: coord.lng,
        country: options.country,
      },
    ];
  }

  async reverseGeocode(point: GeoLatLng): Promise<GeoGeocodeResult> {
    return {
      address: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
      lat: point.lat,
      lng: point.lng,
    };
  }

  async directions(
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[],
    ctx: GeoProviderContext,
  ): Promise<GeoDirectionsResult> {
    const points = [origin, ...waypoints, destination];
    const straight = pathLengthMeters(points);
    // معامل التواء الحضري (الطرق أطول من الخط المستقيم).
    const distanceMeters = Math.round(straight * 1.3);
    const speed = ctx.averageSpeedKmh > 0 ? ctx.averageSpeedKmh : 30;
    const durationSeconds = Math.round((distanceMeters / 1000 / speed) * 3600);
    const polyline = encodePolyline(interpolatePath(points));
    return {
      distanceMeters,
      durationSeconds,
      polyline,
      provider: this.name,
      approximate: true,
    };
  }

  /** يحلّل "lat,lng" إن أمكن. */
  private parseCoordinate(text: string): GeoLatLng | null {
    const match = text
      .trim()
      .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }
    return { lat, lng };
  }
}
