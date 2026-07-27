import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>("redisUrl") as string);
    // معالج أخطاء إلزامي: بدونه يُطلق ioredis حدث "error"
    // غير ملتقَط يُسقِط العملية (unhandled 'error' event).
    this.client.on("error", (err) => {
      // تسجيل فقط؛ ioredis يعيد الاتصال تلقائيًا.
      this.logger.error(`Redis connection error: ${err?.message ?? "unknown"}`);
    });
  }

  /** تخزين موقع السائق + حضور مؤقت (TTL 30s) */
  async setDriverLocation(
    driverId: string,
    lat: number,
    lng: number,
    heading = 0,
  ): Promise<void> {
    // خط أنابيب واحد (round-trip واحد) بدل ثلاث رحلات منفصلة.
    await this.client
      .multi()
      .geoadd("drivers:geo", lng, lat, driverId)
      .hset(`driver:${driverId}`, {
        lat: String(lat),
        lng: String(lng),
        heading: String(heading),
        ts: String(Date.now()),
      })
      .expire(`driver:${driverId}`, 30)
      .exec();
  }

  /**
   * يزيل السائق من الفهرس الجغرافي + حضوره (عند قطع الاتصال أو
   * الخروج OFFLINE). بدونه يتراكم `drivers:geo` بلا حد (نمو ذاكرة)
   * وتُرسل عروض لسائقين غير متصلين.
   */
  async removeDriverLocation(driverId: string): Promise<void> {
    await this.client
      .multi()
      .zrem("drivers:geo", driverId)
      .del(`driver:${driverId}`)
      .exec();
  }

  /** السائقون قرب نقطة ضمن نصف قطر (كم) */
  async nearbyDrivers(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<string[]> {
    const res = (await this.client.georadius(
      "drivers:geo",
      lng,
      lat,
      radiusKm,
      "km",
      "ASC",
    )) as string[];
    return res;
  }

  /**
   * السائقون قرب نقطة **مع إحداثياتهم** (WITHCOORD) مرتّبين من الأقرب.
   *
   * ضروري لحساب ETA الحقيقي في المطابقة: محرك التوجيه يحتاج موقع كل سائق،
   * وجلبه باستدعاء منفرد لكل سائق يعيد مشكلة N+1 داخل المسار الحرج.
   */
  async nearbyDriversWithCoords(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<Array<{ driverId: string; lat: number; lng: number }>> {
    const res = (await this.client.georadius(
      "drivers:geo",
      lng,
      lat,
      radiusKm,
      "km",
      "WITHCOORD",
      "ASC",
    )) as unknown as Array<[string, [string, string]]>;
    const out: Array<{ driverId: string; lat: number; lng: number }> = [];
    for (const entry of res ?? []) {
      const driverId = entry?.[0];
      const coord = entry?.[1];
      if (!driverId || !coord) continue;
      const entryLng = Number(coord[0]);
      const entryLat = Number(coord[1]);
      if (!Number.isFinite(entryLat) || !Number.isFinite(entryLng)) continue;
      out.push({ driverId, lat: entryLat, lng: entryLng });
    }
    return out;
  }

  // سكربت Lua ذرّي: لا يحذف القفل إلا إن طابق الـ token (مالكه).
  private static readonly RELEASE_LOCK_LUA =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

  /**
   * قفل موزّع عام (SET key token PX ttl NX). يُرجع true عند النجاح فقط.
   * أساس المطابقة الموزّعة: يمنع نسختين/رحلتين من احتكار المورد نفسه.
   */
  async acquireLock(
    key: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : 1;
    const res = await this.client.set(key, token, "PX", ttl, "NX");
    return res === "OK";
  }

  /**
   * تحرير قفل بأمان (compare-and-delete عبر Lua ذرّي): لا يحذف إلا إن كان
   * المالك هو نفس صاحب الـ token — يمنع تحرير قفل نسخة أخرى بعد انتهاء المهلة.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    const res = await this.client.eval(
      RedisService.RELEASE_LOCK_LUA,
      1,
      key,
      token,
    );
    return res === 1;
  }

  /** جلب دفعي لقيم مفاتيح (pipeline) بترتيب المدخلات؛ null لغير الموجود. */
  async getKeys(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];
    const pipeline = this.client.pipeline();
    for (const k of keys) pipeline.get(k);
    const res = await pipeline.exec();
    return keys.map((_, i) => (res?.[i]?.[1] as string | null) ?? null);
  }

  /**
   * ينشئ اتصال Redis جديدًا (مطلوب لـ Socket.IO Redis Adapter
   * الذي يحتاج زوج pub/sub منفصل عن عميل الأوامر).
   */
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async onModuleDestroy(): Promise<void> {
    // إغلاق سلس: ينتظر إنهاء الأوامر قيد التنفيذ قبل قطع الاتصال.
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
