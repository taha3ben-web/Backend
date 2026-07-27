import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import type Redis from "ioredis";
import { RedisService } from "../../modules/redis/redis.service";
import {
  CONFIG_INVALIDATE_CHANNEL,
  DEFAULT_REDIS_TTL_SEC,
  LOCAL_TIER_TTL_MS,
  cacheKey,
  isExpired,
  matchesPattern,
  stableFingerprint,
} from "./config-cache.util";

interface LocalEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * ذاكرة تخزين موزّعة للإعدادات ومفاتيح الميزات على طبقتين:
 *
 * 1. طبقة محلية داخل العملية (5 ثوانٍ) — تمتص الرشقات اللحظية بلا أي شبكة.
 * 2. طبقة Redis مشتركة — تمنع كل نسخة خادم من ضرب قاعدة البيانات منفردةً.
 *
 * المشكلة التي تحلّها: الذاكرة داخل العملية وحدها تعني أنّ تعديل إعداد من لوحة
 * التحكم يظهر في نسخة واحدة فورًا ويتأخر في بقية النسخ — سلوك غير محدّد للمستخدم.
 * لذلك يُنشر إلغاء الصلاحية عبر Redis Pub/Sub فتمسح كل النسخ طبقتها المحلية فورًا.
 *
 * بلا Redis (تطوير/اختبار) تعمل بالطبقة المحلية فقط دون فشل.
 */
@Injectable()
export class ConfigCacheService implements OnModuleDestroy {
  private readonly logger = new Logger("ConfigCache");
  private readonly local = new Map<string, LocalEntry>();
  private subscriber: Redis | null = null;

  constructor(@Optional() private readonly redis?: RedisService) {
    this.subscribe();
  }

  /** مشترك منفصل لأنّ عميل Redis في وضع subscribe لا يقبل أوامر أخرى. */
  private subscribe(): void {
    if (!this.redis) return;
    try {
      const sub = this.redis.duplicate();
      this.subscriber = sub;
      sub.on("error", (err: Error) =>
        this.logger.warn(`قناة إلغاء الصلاحية: ${err.message}`),
      );
      void sub
        .subscribe(CONFIG_INVALIDATE_CHANNEL)
        .catch((err: Error) =>
          this.logger.warn(`تعذر الاشتراك في قناة الإلغاء: ${err.message}`),
        );
      sub.on("message", (_channel: string, pattern: string) => {
        this.clearLocal(pattern);
      });
    } catch (error) {
      this.logger.warn(
        `تعذر تهيئة قناة الإلغاء: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** يبني مفتاحًا من مجال وسياق اختياري. */
  key(namespace: string, context?: unknown): string {
    if (context === undefined) return cacheKey(namespace);
    return cacheKey(namespace, stableFingerprint(context));
  }

  /**
   * يُرجع القيمة من الذاكرة أو يستدعي `loader` ويخزّن نتيجته.
   * أي خطأ في الذاكرة لا يمنع الطلب — يُسقط إلى المصدر مباشرة.
   */
  async remember<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSec: number = DEFAULT_REDIS_TTL_SEC,
  ): Promise<T> {
    const localHit = this.local.get(key);
    if (localHit && !isExpired(localHit.expiresAt)) {
      return localHit.value as T;
    }

    if (this.redis) {
      try {
        const raw = await this.redis.client.get(key);
        if (raw) {
          const value = JSON.parse(raw) as T;
          this.setLocal(key, value);
          return value;
        }
      } catch (error) {
        this.logger.warn(
          `قراءة الذاكرة فشلت لـ ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const fresh = await loader();
    this.setLocal(key, fresh);
    if (this.redis) {
      try {
        await this.redis.client.set(
          key,
          JSON.stringify(fresh),
          "EX",
          Math.max(1, Math.trunc(ttlSec)),
        );
      } catch (error) {
        this.logger.warn(
          `كتابة الذاكرة فشلت لـ ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return fresh;
  }

  /**
   * يلغي صلاحية كل ما يبدأ بـ namespace في كل النسخ.
   * يستخدم SCAN (وليس KEYS) لأنّ KEYS يحجب Redis على القواعد الكبيرة.
   */
  async invalidate(namespace: string): Promise<void> {
    const pattern = `${cacheKey(namespace)}*`;
    this.clearLocal(pattern);
    if (!this.redis) return;
    try {
      let cursor = "0";
      do {
        const [next, keys] = (await this.redis.client.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          200,
        )) as [string, string[]];
        cursor = next;
        if (keys.length) await this.redis.client.del(...keys);
      } while (cursor !== "0");
      await this.redis.client.publish(CONFIG_INVALIDATE_CHANNEL, pattern);
    } catch (error) {
      this.logger.warn(
        `إلغاء الصلاحية فشل لـ ${pattern}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private setLocal(key: string, value: unknown): void {
    this.local.set(key, { value, expiresAt: Date.now() + LOCAL_TIER_TTL_MS });
  }

  private clearLocal(pattern: string): void {
    for (const key of Array.from(this.local.keys())) {
      if (matchesPattern(key, pattern)) this.local.delete(key);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
  }
}
