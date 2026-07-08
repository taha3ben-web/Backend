import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>("redisUrl") as string);
    // معالج أخطاء إلزامي: بدونه يُطلق ioredis حدث "error"
    // غير ملتقَط يُسقِط العملية (unhandled 'error' event).
    this.client.on("error", (err) => {
      // تسجيل فقط؛ ioredis يعيد الاتصال تلقائيًا.
      // eslint-disable-next-line no-console
      console.error("[redis] connection error:", err?.message ?? err);
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
