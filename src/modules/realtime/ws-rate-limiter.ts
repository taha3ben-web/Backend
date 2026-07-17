/**
 * مُقنّن معدّل أحداث WebSocket لكل (socket, event) عبر خوارزمية دلو
 * الرموز (Token Bucket). يُخزّن في الذاكرة لكل اتصال — وهذا كافٍ لأن
 * اتصال Socket.IO ملتصق بنسخة خادم واحدة، فيتجنّب جولة شبكة إلى Redis
 * على المسار الساخن (مثل driver:location كل 1–2 ثانية).
 */

export interface RateLimitConfig {
  /** أقصى دفعة فورية (سعة الدلو). */
  capacity: number;
  /** معدّل إعادة التعبئة المستدام (رمز/ثانية). */
  refillPerSec: number;
}

/**
 * حدود لكل نوع حدث. الأحداث عالية التردد (driver:location) تأخذ سعة
 * أعلى، والأوامر الحسّاسة (ride:request) تأخذ سعة أقل.
 */
export const WS_EVENT_LIMITS: Record<string, RateLimitConfig> = {
  "driver:location": { capacity: 15, refillPerSec: 3 },
  "trip:join": { capacity: 10, refillPerSec: 1 },
  "ride:request": { capacity: 5, refillPerSec: 0.5 },
  "ride:accept": { capacity: 10, refillPerSec: 1 },
  "ride:decline": { capacity: 10, refillPerSec: 1 },
  "ride:cancel": { capacity: 5, refillPerSec: 0.5 },
  "trip:status": { capacity: 20, refillPerSec: 2 },
};

/** الحدّ الافتراضي لأي حدث غير مُدرج أعلاه. */
export const DEFAULT_WS_LIMIT: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 1,
};

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class WsRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * @param now دالة الوقت (قابلة للحقن للاختبار). الافتراضي Date.now.
   */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * يحاول استهلاك رمز واحد للحدث المعطى. يعيد true إذا سُمح، false عند التجاوز.
   */
  tryConsume(event: string, cfg: RateLimitConfig): boolean {
    const t = this.now();
    let bucket = this.buckets.get(event);
    if (!bucket) {
      bucket = { tokens: cfg.capacity, lastRefillMs: t };
      this.buckets.set(event, bucket);
    }

    // إعادة تعبئة تناسبية للوقت المنقضي، بحدّ أقصى السعة.
    const elapsedSec = Math.max(0, (t - bucket.lastRefillMs) / 1000);
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(
        cfg.capacity,
        bucket.tokens + elapsedSec * cfg.refillPerSec,
      );
      bucket.lastRefillMs = t;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}
