import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { GeoProviderService } from "./geo-provider.service";
import { InternalGeoProvider } from "./providers/internal-geo.provider";
import { OsrmGeoProvider } from "./providers/osrm-geo.provider";
import {
  GeoDirectionsResult,
  GeoLatLng,
} from "./providers/geo-provider.interface";
import { haversineMeters } from "./geo.util";

/** مدة صلاحية كاش المسار (المسافة شبه ثابتة، والمدة تتغير مع الازدحام). */
const ROUTE_CACHE_TTL_SEC = 300;

/** دقة تدوير الإحداثيات لمفتاح الكاش: 4 خانات ≈ 11 مترًا (يرفع نسبة الإصابة). */
const CACHE_GRID_DECIMALS = 4;

/** أقصى عدد استدعاءات توجيه متزامنة عند حساب ETA لعدة مرشحين. */
const ETA_CONCURRENCY = 5;

export interface RouteResult extends GeoDirectionsResult {
  distanceKm: number;
  /** من أين جاءت النتيجة: مزوّد حي، كاش، أو ارتداد تقريبي. */
  source: "provider" | "cache" | "fallback";
}

export interface EtaResult {
  durationSeconds: number;
  distanceMeters: number;
  approximate: boolean;
}

/**
 * طبقة التوجيه الموحّدة (Routing).
 *
 * كل من يحتاج مسافة أو مدة حقيقية (التسعير، المطابقة، عروض الأسعار، الرحلات)
 * يستخدم هذه الخدمة **ولا يحسب المسافة يدويًا بـ Haversine**، لأن المسافة الهوائية
 * تعني تسعيرًا غير عادل للطرفين وترتيب مرشحين خاطئًا (أقرب جغرافيًا ≠ أسرع وصولًا).
 *
 * المستويات الثلاثة بالترتيب:
 * 1) كاش Redis بمفتاح مُدوّر إلى شبكة ≈ 11 مترًا (يحمي المزوّد ويرد في ملي ثانية).
 * 2) المزوّد المُفعّل من اللوحة (osrm أو google).
 * 3) ارتداد تقريبي داخلي عند فشل المزوّد — الرحلة لا تتوقف أبدًا لأن الخريطة تعطّلت،
 *    وتُوسم النتيجة `approximate: true` حتى تظهر في المراقبة ولا تُخفى.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly providers: GeoProviderService,
    private readonly redis: RedisService,
    private readonly internal: InternalGeoProvider,
    private readonly osrm: OsrmGeoProvider,
  ) {}

  /** مسار حقيقي بين نقطتين (مع نقاط وسطية اختيارية). */
  async route(
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[] = [],
  ): Promise<RouteResult> {
    const { provider, ctx } = await this.providers.resolve();
    const cacheKey = this.buildCacheKey(
      provider.name,
      origin,
      destination,
      waypoints,
    );

    const cached = await this.readCache(cacheKey);
    if (cached) return { ...cached, source: "cache" };

    try {
      const result = await provider.directions(
        origin,
        destination,
        waypoints,
        ctx,
      );
      const enriched = this.withKm(result);
      // لا نكاش النتائج التقريبية الداخلية — لا قيمة لحفز حساب محلي رخيص.
      if (!result.approximate) await this.writeCache(cacheKey, enriched);
      return { ...enriched, source: "provider" };
    } catch (error) {
      this.logger.warn(
        `فشل مزوّد التوجيه ${provider.name}: ${
          error instanceof Error ? error.message : "unknown"
        } — ارتداد إلى الحساب التقريبي`,
      );
      const fallback = await this.internal.directions(
        origin,
        destination,
        waypoints,
        ctx,
      );
      return { ...this.withKm(fallback), source: "fallback" };
    }
  }

  /**
   * مدد الوصول من عدة سائقين إلى نقطة الانطلاق — تُستخدم في ترتيب المرشحين.
   * مع OSRM تُحسب كلها في استدعاء واحد (`/table`)، وإلا بتوازٍ محدود، وعند
   * الفشل تُقدّر محليًا فيبقى الإسناد عاملًا دائمًا.
   */
  async etaFromMany(
    sources: GeoLatLng[],
    destination: GeoLatLng,
  ): Promise<EtaResult[]> {
    if (!sources.length) return [];
    const { provider, ctx } = await this.providers.resolve();

    if (provider.name === this.osrm.name) {
      try {
        const table = await this.osrm.durationsTo(sources, destination, ctx);
        return table.map((entry, i) =>
          entry
            ? { ...entry, approximate: false }
            : this.approximateEta(sources[i], destination, ctx.averageSpeedKmh),
        );
      } catch (error) {
        this.logger.warn(
          `فشل OSRM /table: ${
            error instanceof Error ? error.message : "unknown"
          } — تقدير تقريبي`,
        );
        return sources.map((s) =>
          this.approximateEta(s, destination, ctx.averageSpeedKmh),
        );
      }
    }

    const results: EtaResult[] = [];
    for (let i = 0; i < sources.length; i += ETA_CONCURRENCY) {
      const batch = sources.slice(i, i + ETA_CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (source) => {
          try {
            const route = await this.route(source, destination);
            return {
              durationSeconds: route.durationSeconds,
              distanceMeters: route.distanceMeters,
              approximate: route.approximate,
            };
          } catch {
            return this.approximateEta(
              source,
              destination,
              ctx.averageSpeedKmh,
            );
          }
        }),
      );
      results.push(...settled);
    }
    return results;
  }

  /** تقدير محلي أخير (مسافة هوائية × معامل تواء حضري 1.3). */
  private approximateEta(
    from: GeoLatLng,
    to: GeoLatLng,
    averageSpeedKmh: number,
  ): EtaResult {
    const distanceMeters = Math.round(haversineMeters(from, to) * 1.3);
    const speed = averageSpeedKmh > 0 ? averageSpeedKmh : 30;
    return {
      distanceMeters,
      durationSeconds: Math.round((distanceMeters / 1000 / speed) * 3600),
      approximate: true,
    };
  }

  private withKm(result: GeoDirectionsResult): Omit<RouteResult, "source"> {
    return {
      ...result,
      distanceKm: Number((result.distanceMeters / 1000).toFixed(3)),
    };
  }

  private buildCacheKey(
    providerName: string,
    origin: GeoLatLng,
    destination: GeoLatLng,
    waypoints: GeoLatLng[],
  ): string {
    const snap = (point: GeoLatLng) =>
      `${point.lat.toFixed(CACHE_GRID_DECIMALS)},${point.lng.toFixed(
        CACHE_GRID_DECIMALS,
      )}`;
    const path = [origin, ...waypoints, destination].map(snap).join("|");
    return `route:${providerName}:${path}`;
  }

  private async readCache(
    key: string,
  ): Promise<Omit<RouteResult, "source"> | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as Omit<RouteResult, "source">;
    } catch {
      // الكاش ليس مصدر حقيقة — أي خلل فيه يُتجاوز بصمت.
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: Omit<RouteResult, "source">,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(value),
        "EX",
        ROUTE_CACHE_TTL_SEC,
      );
    } catch {
      // تجاهل متعمّد.
    }
  }
}
