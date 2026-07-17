import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { AppException } from "../../common/api/app.exception";
import {
  LoginThrottleConfig,
  failureKey,
  lockKey,
  parseLoginThrottleConfig,
  remainingAttempts,
  shouldLock,
} from "./login-throttle.util";

/**
 * حماية تسجيل الدخول من هجمات القوة الغاشمة: عدّاد محاولات فاشلة
 * لكل حساب (رقم هاتف مطبّع) + قفل مؤقت عند تجاوز الحد، مخزّن في Redis
 * (يعمل عبر عدة نسخ من الخادم). مكمّل لـ ThrottlerGuard العام (تقنين عام لكل IP)
 * لكنه يستهدف بيانات الاعتماد تحديدًا.
 *
 * fail-open: أي خلل في Redis لا يكسر تسجيل الدخول (التوافر أولوية).
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly cfg: LoginThrottleConfig;

  constructor(private readonly redis: RedisService) {
    this.cfg = parseLoginThrottleConfig(process.env);
  }

  /**
   * يرمي RATE_LIMITED (429) إن كان الحساب مقفولًا حاليًا، مع مدة الانتظار.
   */
  async assertNotLocked(identifier: string): Promise<void> {
    let ttl: number;
    try {
      ttl = await this.redis.client.ttl(lockKey(identifier));
    } catch (err) {
      this.logger.warn(
        `تعذّر فحص قفل الدخول (fail-open): ${(err as Error).message}`,
      );
      return;
    }
    if (ttl > 0) {
      throw new AppException("RATE_LIMITED", {
        details: { reason: "account_locked", retryAfterSeconds: ttl },
      });
    }
  }

  /**
   * يسجّل محاولة فاشلة؛ ويقفل الحساب مؤقتًا عند بلوغ الحد.
   * يعيد عدد المحاولات المتبقية (0 إن حدث القفل).
   */
  async recordFailure(identifier: string): Promise<number> {
    try {
      const key = failureKey(identifier);
      const attempts = await this.redis.client.incr(key);
      // نضبط انتهاء النافذة عند أول محاولة فقط (نافذة منزلقة ثابتة).
      if (attempts === 1) {
        await this.redis.client.expire(key, this.cfg.windowSec);
      }
      if (shouldLock(attempts, this.cfg.maxAttempts)) {
        await this.redis.client
          .multi()
          .set(lockKey(identifier), "1", "EX", this.cfg.lockSec)
          .del(key)
          .exec();
        this.logger.warn(
          `قفل دخول مؤقت (${this.cfg.lockSec}ث) بعد ${attempts} محاولة فاشلة.`,
        );
        return 0;
      }
      return remainingAttempts(attempts, this.cfg.maxAttempts);
    } catch (err) {
      this.logger.warn(
        `تعذّر تسجيل فشل الدخول (fail-open): ${(err as Error).message}`,
      );
      return this.cfg.maxAttempts;
    }
  }

  /** يمسح العدّاد والقفل بعد نجاح الدخول. fail-open. */
  async recordSuccess(identifier: string): Promise<void> {
    try {
      await this.redis.client.del(failureKey(identifier), lockKey(identifier));
    } catch (err) {
      this.logger.warn(
        `تعذّر مسح عدّاد الدخول (fail-open): ${(err as Error).message}`,
      );
    }
  }
}
