import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  computeSurgeMultiplier,
  normalizeConfig,
  type SurgeConfig,
} from "./surge.util";

/**
 * التسعير الديناميكي الحيّ (Live Surge).
 *
 * `surge.util.ts` كان مكتوبًا ومختبرًا منذ البداية لكنّه **لم يكن موصولًا بأي شيء**:
 * المضاعف كان يأتي من `peakMultiplier` الثابت في قاعدة السعر فقط، فلا يرتفع السعر
 * عند ندرة السائقين ولا ينخفض عند وفرتهم. هذه الخدمة تصل المنطق بالواقع:
 *
 *  - **الطلب**: الرحلات في حالة بحث (`SEARCHING`) قرب النقطة خلال نافذة قصيرة.
 *  - **العرض**: السائقون المتاحون فعليًا في Redis (GEO) داخل نفس نصف القطر.
 *
 * النتيجة تُخزّن لفترة قصيرة لكل خلية جغرافية حتّى لا يتقلّب السعر بين طلبين متتاليين
 * ولتخفيف الضغط على قاعدة البيانات.
 *
 * المبدأ الأمان: أي خلل (Redis معطّل، استعلام فاشل) يُرجع مضاعفًا = 1، أي السعر
 * العادي — لا يجوز أبدًا أن يرفع خطأ تقني فاتورة الراكب.
 */

/** نصف قطر قياس الطلب/العرض (كم). */
export const SURGE_RADIUS_KM = 3;
/** نافذة احتساب الطلب (دقائق). */
export const SURGE_DEMAND_WINDOW_MIN = 10;
/** مدّة تخزين المضاعف (ثوانٍ). */
export const SURGE_CACHE_TTL_SEC = 60;
/** دقّة الخلية الجغرافية للتخزين (خانتان ≈ 1.1 كم). */
export const SURGE_CELL_DECIMALS = 2;

export interface SurgeSnapshot {
  multiplier: number;
  demand: number;
  supply: number;
  radiusKm: number;
  /** مصدر القيمة: محسوبة أم من الذاكرة أم احتياطية عند الفشل. */
  source: "computed" | "cache" | "fallback";
}

/** مفتاح الخلية الجغرافية (دالة نقية). */
export function surgeCellKey(lat: number, lng: number): string {
  const la = lat.toFixed(SURGE_CELL_DECIMALS);
  const ln = lng.toFixed(SURGE_CELL_DECIMALS);
  return `surge:${la}:${ln}`;
}

/** يقرأ إعدادات الـ surge من البيئة (دالة نقية قابلة للاختبار). */
export function surgeConfigFromEnv(
  env: Record<string, string | undefined>,
): SurgeConfig {
  const num = (v?: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return normalizeConfig({
    threshold: num(env.SURGE_THRESHOLD),
    sensitivity: num(env.SURGE_SENSITIVITY),
    maxMultiplier: num(env.SURGE_MAX_MULTIPLIER),
    step: num(env.SURGE_STEP),
    minDemand: num(env.SURGE_MIN_DEMAND),
  });
}

@Injectable()
export class SurgeService {
  private readonly logger = new Logger("Surge");
  private readonly config = surgeConfigFromEnv(process.env);
  /** مفتاح إيقاف عام: `SURGE_ENABLED=false` يُعيد السلوك القديم فورًا. */
  private readonly enabled = process.env.SURGE_ENABLED !== "false";

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * يُرجع مضاعف الـ surge لنقطة الالتقاط (1 = بلا تصاعد).
   * لا يرمي أبدًا.
   */
  async multiplierAt(lat: number, lng: number): Promise<number> {
    const snap = await this.snapshotAt(lat, lng);
    return snap.multiplier;
  }

  /** لقطة كاملة (للوحة التحكّم والشفافية مع السائق). */
  async snapshotAt(lat: number, lng: number): Promise<SurgeSnapshot> {
    const base: SurgeSnapshot = {
      multiplier: 1,
      demand: 0,
      supply: 0,
      radiusKm: SURGE_RADIUS_KM,
      source: "fallback",
    };
    if (!this.enabled || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return base;
    }

    const key = surgeCellKey(lat, lng);
    try {
      const cached = await this.redis?.client.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SurgeSnapshot;
        return { ...parsed, source: "cache" };
      }
    } catch {
      // تجاهل أعطال الذاكرة واحسب من جديد.
    }

    try {
      const [demand, supply] = await Promise.all([
        this.countDemand(lat, lng),
        this.countSupply(lat, lng),
      ]);
      const multiplier = computeSurgeMultiplier(demand, supply, this.config);
      const snapshot: SurgeSnapshot = {
        multiplier,
        demand,
        supply,
        radiusKm: SURGE_RADIUS_KM,
        source: "computed",
      };
      await this.redis?.client
        .set(key, JSON.stringify(snapshot), "EX", SURGE_CACHE_TTL_SEC)
        .catch(() => undefined);
      return snapshot;
    } catch (error) {
      this.logger.warn(
        `تعذر حساب surge: ${error instanceof Error ? error.message : String(error)}`,
      );
      return base;
    }
  }

  /**
   * خريطة حرارية مبسّطة: تجميع الرحلات الباحثة إلى خلايا جغرافية
   * مع مضاعف كل خلية — يستخدمها تطبيق السائق لمعرفة أين يتجه.
   */
  async heatmap(
    minutes = SURGE_DEMAND_WINDOW_MIN,
  ): Promise<Array<{ lat: number; lng: number; demand: number }>> {
    const since = new Date(Date.now() - minutes * 60_000);
    const trips = await this.prisma.trip.findMany({
      where: { status: "SEARCHING", createdAt: { gte: since } },
      select: { pickupLat: true, pickupLng: true },
      take: 5000,
    });

    const cells = new Map<
      string,
      { lat: number; lng: number; demand: number }
    >();
    for (const t of trips) {
      const lat = Number(t.pickupLat.toFixed(SURGE_CELL_DECIMALS));
      const lng = Number(t.pickupLng.toFixed(SURGE_CELL_DECIMALS));
      const key = `${lat}:${lng}`;
      const found = cells.get(key);
      if (found) found.demand += 1;
      else cells.set(key, { lat, lng, demand: 1 });
    }
    return [...cells.values()]
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 300);
  }

  /** عدد الرحلات الباحثة داخل مربّع تقريبي حول النقطة (أرخص من حساب مسافة دقيق). */
  private async countDemand(lat: number, lng: number): Promise<number> {
    const latDelta = SURGE_RADIUS_KM / 111;
    const lngDelta =
      SURGE_RADIUS_KM / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const since = new Date(Date.now() - SURGE_DEMAND_WINDOW_MIN * 60_000);
    return this.prisma.trip.count({
      where: {
        status: "SEARCHING",
        createdAt: { gte: since },
        pickupLat: { gte: lat - latDelta, lte: lat + latDelta },
        pickupLng: { gte: lng - lngDelta, lte: lng + lngDelta },
      },
    });
  }

  /** عدد السائقين المتاحين فعليًا حول النقطة (Redis GEO). */
  private async countSupply(lat: number, lng: number): Promise<number> {
    if (!this.redis) return 0;
    const drivers = await this.redis.nearbyDrivers(lat, lng, SURGE_RADIUS_KM);
    return drivers.length;
  }
}
