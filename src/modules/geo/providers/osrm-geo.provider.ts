import { Injectable, Logger } from "@nestjs/common";
import {
  GeoDirectionsResult,
  GeoGeocodeResult,
  GeoLatLng,
  GeoPlaceSuggestion,
  GeoProvider,
  GeoProviderContext,
} from "./geo-provider.interface";
import { InternalGeoProvider } from "./internal-geo.provider";

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: string;
}

interface OsrmRouteResponse {
  code?: string;
  routes?: OsrmRoute[];
}

interface OsrmTableResponse {
  code?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

/**
 * مزوّد توجيه OSRM (مستضاف ذاتيًا على بيانات OpenStreetMap).
 *
 * لماذا OSRM هو الاختيار الافتراضي للتوجيه:
 * - مسافة ومدة على شبكة طرق حقيقية (لا خط مستقيم × معامل تواء).
 * - زمن استجابة ملي ثانية واحدة تقريبًا داخل نفس الشبكة، وبلا تكلفة لكل استدعاء،
 *   فيمكن استدعاءه في **مسار المطابقة** لكل مرشح، وهو ما يجعل Google غير
 *   عملي اقتصاديًا في هذا الموقع تحديدًا.
 * - يدعم `/table` في استدعاء واحد لحساب ETA لعدة سائقين دفعةً واحدة.
 *
 * البحث والعنونة (autocomplete/geocode) ليسا من مسؤولية OSRM، فيُفوّضان للمزوّد
 * الداخلي حتى تبقى الواجهة مكتملة دون مفاتيح خارجية.
 */
@Injectable()
export class OsrmGeoProvider implements GeoProvider {
  readonly name = "osrm";
  private readonly logger = new Logger(OsrmGeoProvider.name);
  private readonly timeoutMs = 4000;

  constructor(private readonly internal: InternalGeoProvider) {}

  private requireBaseUrl(ctx: GeoProviderContext): string {
    const base = ctx.baseUrl?.trim().replace(/\/+$/, "");
    if (!base) throw new Error("OSRM_BASE_URL_MISSING");
    return base;
  }

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`OSRM_HTTP_${response.status}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** تنسيق OSRM للإحداثيات: lng,lat (معكوس عن المعتاد — مصدر أخطاء شائع). */
  private toCoord(point: GeoLatLng): string {
    return `${point.lng},${point.lat}`;
  }

  async autocomplete(
    query: string,
    options: { lat?: number; lng?: number; country?: string; limit: number },
    ctx: GeoProviderContext,
  ): Promise<GeoPlaceSuggestion[]> {
    void ctx;
    return this.internal.autocomplete(query, options);
  }

  async geocode(
    query: string,
    options: { country?: string },
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult[]> {
    void ctx;
    return this.internal.geocode(query, options);
  }

  async reverseGeocode(
    point: GeoLatLng,
    ctx: GeoProviderContext,
  ): Promise<GeoGeocodeResult> {
    void ctx;
    return this.internal.reverseGeocode(point);
  }

  async directions(
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[],
    ctx: GeoProviderContext,
  ): Promise<GeoDirectionsResult> {
    const base = this.requireBaseUrl(ctx);
    const coords = [origin, ...waypoints, destination]
      .map((p) => this.toCoord(p))
      .join(";");
    const params = new URLSearchParams({
      overview: "full",
      geometries: "polyline",
      steps: "false",
      alternatives: "false",
    });
    const data = await this.getJson<OsrmRouteResponse>(
      `${base}/route/v1/driving/${coords}?${params.toString()}`,
    );
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error("OSRM_NO_ROUTE");
    return {
      distanceMeters: Math.round(route.distance ?? 0),
      durationSeconds: Math.round(route.duration ?? 0),
      polyline: route.geometry ?? "",
      provider: this.name,
      approximate: false,
    };
  }

  /**
   * مدد الوصول من عدة نقاط انطلاق إلى هدف واحد في استدعاء واحد (خدمة `/table`).
   * تُستخدم في المطابقة لترتيب المرشحين بـ ETA حقيقي بدل المسافة الهوائية.
   */
  async durationsTo(
    sources: GeoLatLng[],
    destination: GeoLatLng,
    ctx: GeoProviderContext,
  ): Promise<
    Array<{ durationSeconds: number; distanceMeters: number } | null>
  > {
    if (!sources.length) return [];
    const base = this.requireBaseUrl(ctx);
    const coords = [...sources, destination]
      .map((p) => this.toCoord(p))
      .join(";");
    const destinationIndex = sources.length;
    const params = new URLSearchParams({
      sources: sources.map((_, i) => String(i)).join(";"),
      destinations: String(destinationIndex),
      annotations: "duration,distance",
    });
    const data = await this.getJson<OsrmTableResponse>(
      `${base}/table/v1/driving/${coords}?${params.toString()}`,
    );
    if (data.code !== "Ok") throw new Error("OSRM_TABLE_FAILED");
    return sources.map((_, i) => {
      const duration = data.durations?.[i]?.[0];
      const distance = data.distances?.[i]?.[0];
      if (duration === null || duration === undefined) return null;
      return {
        durationSeconds: Math.round(duration),
        distanceMeters: Math.round(distance ?? 0),
      };
    });
  }
}
