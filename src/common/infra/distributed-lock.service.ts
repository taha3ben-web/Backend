import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomBytes } from "crypto";
import { RedisService } from "../../modules/redis/redis.service";
import {
  lockBackoffMs,
  lockKey,
  withJitter,
  LOCK_DEFAULT_TIMEOUT_MS,
  LOCK_DEFAULT_TTL_MS,
  LOCK_RELEASE_SCRIPT,
} from "./distributed-lock.util";

export interface LockOptions {
  /** مدة صلاحية القفل (مللي ثانية) — انتهاؤها يمنع الجمود (deadlock). */
  ttlMs?: number;
  /** أقصى مدة انتظار للحصول على القفل قبل الاستسلام. */
  timeoutMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * قفل موزّع مبني على Redis (SET NX PX + إطلاق ذرّي عبر Lua).
 *
 * - كل قفل له رمز (token) فريد؛ الإطلاق يحذف المفتاح فقط إن طابق الرمز.
 * - TTL إلزامي لمنع الجمود إذا توقفت العملية المالكة.
 * - إن لم يتوفر Redis (تطوير/اختبار) يعمل بأفضل جهد دون قفل حقيقي
 *   (الحماية الأساسية تبقى عزل Serializable في المعاملات).
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger("DistributedLock");

  constructor(@Optional() private readonly redis?: RedisService) {}

  /** يحاول الحصول على القفل؛ يُرجع الرمز عند النجاح أو null عند انتهاء المهلة. */
  async acquire(
    name: string,
    options: LockOptions = {},
  ): Promise<string | null> {
    const token = randomBytes(16).toString("hex");
    if (!this.redis) {
      // لا يوجد Redis — قفل صوري (نسخة واحدة/اختبار).
      return token;
    }
    const key = lockKey(name);
    const ttlMs = options.ttlMs ?? LOCK_DEFAULT_TTL_MS;
    const deadline =
      Date.now() + (options.timeoutMs ?? LOCK_DEFAULT_TIMEOUT_MS);
    let attempt = 0;

    for (;;) {
      const result = await (this.redis.client as any).set(
        key,
        token,
        "PX",
        ttlMs,
        "NX",
      );
      if (result === "OK") return token;

      attempt += 1;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const delay = Math.min(withJitter(lockBackoffMs(attempt)), remaining);
      await sleep(delay);
    }
  }

  /** يُطلق القفل ذرّيًا إن طابق الرمز (يتجاهل الأخطاء — القفل سينتهي بـ TTL). */
  async release(name: string, token: string): Promise<void> {
    if (!this.redis) return;
    try {
      await (this.redis.client as any).eval(
        LOCK_RELEASE_SCRIPT,
        1,
        lockKey(name),
        token,
      );
    } catch (error) {
      this.logger.warn(
        `lock release failed for ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * تنفيذ حصري للمهام المجدولة (cron): محاولة واحدة دون انتطار،
   * وتخطّي صامت إن كانت نسخة أخرى تنفِّذ المهمة الآن.
   *
   * لماذا لا نستخدم `withLock`: المهمة المجدولة لا يجوز أن تنتظر أو ترمي خطأً
   * لمجرد أن نسخة أخرى سبقتها — التخطي هو السلوك الصحيح.
   */
  async runExclusive<T>(
    name: string,
    fn: () => Promise<T>,
    ttlMs: number = LOCK_DEFAULT_TTL_MS,
  ): Promise<T | null> {
    const token = await this.acquire(name, { ttlMs, timeoutMs: 0 });
    if (!token) {
      this.logger.debug(`تخطي ${name} — نسخة أخرى تملك القفل`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release(name, token);
    }
  }

  /**
   * ينفّذ `fn` تحت قفل موزّع؛ يُطلق القفل دائمًا في finally.
   * يرمي إذا تعذّر الحصول على القفل خلال المهلة.
   */
  async withLock<T>(
    name: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const token = await this.acquire(name, options);
    if (!token) {
      throw new Error(`Could not acquire distributed lock: ${name}`);
    }
    try {
      return await fn();
    } finally {
      await this.release(name, token);
    }
  }
}
