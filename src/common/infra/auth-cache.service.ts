import { Injectable } from "@nestjs/common";
import { RedisService } from "../../modules/redis/redis.service";

/** هوية المستخدم المخزّنة مؤقتًا (النوع + الحالة) لتفادي استعلام قاعدة البيانات في كل طلب. */
export interface CachedIdentity {
  type: string;
  status: string;
}

interface CachedPermissions {
  /** نسخة RBAC وقت التخزين؛ أي تغيير على صلاحيات الأدوار يرفعها فيُبطل الكاش. */
  v: string;
  keys: string[];
}

const USER_TTL_SECONDS = 60;
const PERMS_TTL_SECONDS = 60;
const RBAC_VERSION_KEY = "auth:rbac:version";

/**
 * ذاكرة تخزين مؤقت للمصادقة والصلاحيات على Redis.
 *
 * الغرض: إزالة استعلامَي قاعدة البيانات المتكرّرَين في المسار الساخن لكل طلب
 * مُصادَق — جلب هوية المستخدم في `JwtStrategy`، وجلب صلاحيات الدور في
 * `PermissionsGuard`.
 *
 * مبادئ السلامة:
 * - Fail-open: أي خطأ في Redis يُعامَل كـ "لا يوجد في الكاش" فيرجع النظام
 *   إلى قاعدة البيانات؛ لا يُحجب المستخدمون أبدًا بسبب عطل في الكاش.
 * - TTL قصير (60 ثانية) كحدّ أقصى لأي بيانات قديمة.
 * - إبطال صريح عند التغييرات الحسّاسة: تغيير حالة المستخدم أو دوره يُبطل
 *   كاشه فورًا؛ تغيير صلاحيات أي دور يرفع نسخة RBAC فيُبطل كل ذواكر
 *   الصلاحيات فورًا (دون الحاجة لتعداد المستخدمين).
 */
@Injectable()
export class AuthCacheService {
  constructor(private readonly redis: RedisService) {}

  private userKey(userId: string): string {
    return `auth:user:${userId}`;
  }

  private permsKey(userId: string): string {
    return `auth:perms:${userId}`;
  }

  /** يُرجع الهوية المخزّنة أو null عند غيابها/أي خطأ (fail-open). */
  async getIdentity(userId: string): Promise<CachedIdentity | null> {
    try {
      const raw = await this.redis.client.get(this.userKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedIdentity;
      if (
        parsed &&
        typeof parsed.type === "string" &&
        typeof parsed.status === "string"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  async setIdentity(userId: string, identity: CachedIdentity): Promise<void> {
    try {
      await this.redis.client.set(
        this.userKey(userId),
        JSON.stringify(identity),
        "EX",
        USER_TTL_SECONDS,
      );
    } catch {
      // تجاهل أخطاء الكتابة في الكاش؛ لا تؤثر على صحّة المصادقة.
    }
  }

  /**
   * يُرجع مصفوفة مفاتيح الصلاحيات المخزّنة (قد تكون فارغة) أو null عند
   * الغياب/اختلاف نسخة RBAC/أي خطأ.
   */
  async getPermissions(userId: string): Promise<string[] | null> {
    try {
      const [rawPerms, rawVersion] = await this.redis.client.mget(
        this.permsKey(userId),
        RBAC_VERSION_KEY,
      );
      if (!rawPerms) return null;
      const parsed = JSON.parse(rawPerms) as CachedPermissions;
      const currentVersion = rawVersion ?? "0";
      if (
        parsed &&
        parsed.v === currentVersion &&
        Array.isArray(parsed.keys)
      ) {
        return parsed.keys;
      }
      return null;
    } catch {
      return null;
    }
  }

  async setPermissions(userId: string, keys: string[]): Promise<void> {
    try {
      const rawVersion = await this.redis.client.get(RBAC_VERSION_KEY);
      const version = rawVersion ?? "0";
      const payload: CachedPermissions = { v: version, keys };
      await this.redis.client.set(
        this.permsKey(userId),
        JSON.stringify(payload),
        "EX",
        PERMS_TTL_SECONDS,
      );
    } catch {
      // تجاهل أخطاء الكتابة في الكاش.
    }
  }

  /** يُبطل كاش هوية وصلاحيات مستخدم واحد (عند تغيير حالته أو دوره). */
  async invalidateUser(userId: string): Promise<void> {
    try {
      await this.redis.client.del(this.userKey(userId), this.permsKey(userId));
    } catch {
      // تجاهل؛ ستنتهي الصلاحية تلقائيًا عبر TTL على أسوأ تقدير.
    }
  }

  /**
   * يرفع نسخة RBAC العالمية، فتصبح كل ذواكر الصلاحيات المخزّنة قديمة فورًا.
   * يُستدعى عند تغيير صلاحيات أي دور (يؤثر على كل المستخدمين الحاملين له).
   */
  async bumpRbacVersion(): Promise<void> {
    try {
      await this.redis.client.incr(RBAC_VERSION_KEY);
    } catch {
      // تجاهل؛ عند تعذّر الرفع تنتهي الصلاحية عبر TTL القصير.
    }
  }
}
