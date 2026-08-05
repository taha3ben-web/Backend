import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Readable } from "node:stream";
import {
  type StorageDriver,
  type StorageObjectMetadata,
  type StorageProviderName,
} from "./storage.driver";
import { R2StorageDriver, type R2Config } from "./drivers/r2.driver";
import { GcsStorageDriver, type GcsConfig } from "./drivers/gcs.driver";

/**
 * خدمة تخزين الملفات الموحّدة (واجهة ثابتة فوق مزوّد قابل للتبديل).
 * تُستخدم لورقة الراكب، ووثائق السائقين، وصور المركبات، والأصول المدارة، والفواتير.
 *
 * اختيار المزوّد من متغيرات البيئة وحدها:
 *  1. إن كانت متغيرات R2 الأربعة الإلزامية مكتملة ← Cloudflare R2 (AWS SDK v3).
 *  2. وإلا وكان GCS_BUCKET مضبوطًا ← Google Cloud Storage (توافق خلفي للملفات القديمة).
 *  3. وإلا تبقى الخدمة معطّلة بأمان (isEnabled=false) دون إسقاط الخادم.
 *
 * لا توجد أي قيمة ثابتة (مفتاح، نطاق، أو bucket) داخل الكود.
 */
/**
 * مقدّمات مفاتيح الكائنات التي يملكها هذا النظام داخل التخزين.
 * تُستخدم لاستخراج مفتاح الكائن من رابط كامل قد يرسله عميل قديم.
 * أي رابط لا يطابق إحداها يُعتبر رابطاً خارجياً ويُحفظ كما هو.
 */
export const OWNED_OBJECT_PREFIXES = [
  "passenger-profiles/",
  "driver-docs/",
] as const;

/**
 * مدّة الرابط الموقّع لصور الملفات الشخصية ووثائق السائقين، وتُستعمل فقط
 * حين لا يكون R2_PUBLIC_URL مضبوطاً. قيمة واحدة مشتركة حتى لا يتفرّع السلوك
 * بين الوحدات كما حدث سابقاً.
 */
export const STORED_MEDIA_READ_TTL_MINUTES = 60 * 24 * 7;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver | null;

  constructor(private readonly config: ConfigService) {
    this.driver = this.resolveDriver();
  }

  /** هل التخزين مضبوط وجاهز للاستخدام؟ */
  isEnabled(): boolean {
    return this.driver !== null;
  }

  /** اسم المزوّد المفعّل (للمراقبة وفحوص السلامة). */
  provider(): StorageProviderName | null {
    return this.driver?.provider ?? null;
  }

  /** وصف موجز لحالة التخزين دون أي سر (لـ health check). */
  status(): {
    enabled: boolean;
    provider: StorageProviderName | null;
    bucket: string | null;
  } {
    return {
      enabled: this.isEnabled(),
      provider: this.driver?.provider ?? null,
      bucket: this.driver?.bucket ?? null,
    };
  }

  /** يرفع ملفًا من الخادم ويُرجِع مساره الداخلي (object path). */
  async upload(
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    return this.ensureDriver().upload(objectPath, data, contentType);
  }

  /** رابط قراءة موقّع مؤقّت (افتراضيًا 15 دقيقة) للملفات الحساسة. */
  async signedReadUrl(
    objectPath: string,
    expiresInMinutes = 15,
  ): Promise<string> {
    return this.ensureDriver().signedReadUrl(objectPath, expiresInMinutes);
  }

  /** رابط رفع موقّع (PUT) يرفع منه التطبيق مباشرةً دون مرور الملف بالخادم. */
  async signedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes = 15,
  ): Promise<string> {
    return this.ensureDriver().signedUploadUrl(
      objectPath,
      contentType,
      expiresInMinutes,
    );
  }

  /** وصف الكائن بعد الرفع المباشر (للتحقّق من النوع والحجم). */
  async objectMetadata(objectPath: string): Promise<StorageObjectMetadata> {
    return this.ensureDriver().objectMetadata(objectPath);
  }

  /** تدفّق قراءة لتمريره مباشرةً إلى الرد (نفس التوقيع المتزامن القديم). */
  readStream(objectPath: string): Readable {
    return this.ensureDriver().readStream(objectPath);
  }

  /** يحذف ملفًا (يتجاهل إن لم يوجد). */
  async delete(objectPath: string): Promise<void> {
    return this.ensureDriver().delete(objectPath);
  }

  /**
   * الرابط العام للكائن من R2_PUBLIC_URL إن كان مضبوطًا، وإلا null.
   * مفيد للأصول العامة (أيقونات، بانرات) لتجنّب توقيع رابط في كل طلب.
   */
  publicUrl(objectPath: string): string | null {
    if (!this.driver) return null;
    return this.driver.publicUrl(objectPath);
  }

  /**
   * الرابط الأفضل للقراءة: العام إن توفر، وإلا رابط موقّع مؤقّت.
   */
  async readUrl(objectPath: string, expiresInMinutes = 15): Promise<string> {
    const direct = this.publicUrl(objectPath);
    if (direct) return direct;
    return this.signedReadUrl(objectPath, expiresInMinutes);
  }

  /**
   * يحوّل ما هو مخزّن في قاعدة البيانات إلى رابط صالح للعرض الآن.
   *
   * المخزّن يجب أن يكون مفتاح الكائن (object key) لا رابطاً موقّعاً، لأن
   * الروابط الموقّعة تنتهي صلاحيتها بينما السجل يبقى. لذلك يُولّد الرابط عند
   * كل قراءة: عام دائم من R2_PUBLIC_URL إن توفّر، وإلا موقّع جديد.
   *
   * تتحمّل القيم القديمة: الرابط الموقّع المحفوظ سابقاً يُقشَّر إلى مفتاحه
   * ثم يُوقّع من جديد، فلا تظهر صورة معطوبة للمستخدم.
   * الروابط الخارجية (مزوّد آخر) تُعاد كما هي.
   */
  async resolveStoredUrl(
    stored: string | null | undefined,
    expiresInMinutes = 15,
  ): Promise<string | null> {
    if (!stored) return null;
    const key = this.toObjectPath(stored);
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) return key;
    if (!this.isEnabled()) return null;
    try {
      return await this.readUrl(key, expiresInMinutes);
    } catch {
      // تعذّر توليد الرابط لا يجب أن يُسقِط الاستجابة بأكملها.
      this.logger.warn(`تعذّر توليد رابط قراءة للكائن ${key}`);
      return null;
    }
  }

  /**
   * يستخرج مفتاح الكائن مما يرسله العميل: مفتاحاً مباشرة (المفضّل) أو رابطاً
   * سبق أن أرجعناه. يُسقِط التوقيع ومعاملات الاستعلام واسم الـ bucket، فلا
   * يُخزَّن رابط مؤقّت في قاعدة البيانات أبداً.
   */
  toObjectPath(
    value: string,
    prefixes: readonly string[] = OWNED_OBJECT_PREFIXES,
  ): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^\/+/, "");
    let pathname: string;
    try {
      // pathname وحده يُسقِط التوقيع لأن المعاملات ليست جزءاً منه.
      pathname = new URL(trimmed).pathname;
    } catch {
      return trimmed;
    }
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = pathname;
    }
    for (const prefix of prefixes) {
      const marker = decoded.indexOf(prefix);
      // القصّ من المقدّمة يتخطّى اسم الـ bucket في نمط المسار تلقائياً.
      if (marker !== -1) return decoded.slice(marker);
    }
    return trimmed;
  }

  /** يختار المزوّد مرةً واحدة عند الإقلاع حسب متغيرات البيئة. */
  private resolveDriver(): StorageDriver | null {
    const r2 = this.readR2Config();
    if (r2) {
      try {
        return new R2StorageDriver(r2);
      } catch (error) {
        this.logger.error(
          `تعذّر تهيئة Cloudflare R2: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const gcs = this.readGcsConfig();
    if (gcs) {
      if (r2) {
        this.logger.warn(
          "إعداد R2 موجود لكن تهيئته فشلت — الرجوع إلى Google Cloud Storage.",
        );
      }
      try {
        return new GcsStorageDriver(gcs);
      } catch (error) {
        this.logger.error(
          `تعذّر تهيئة Google Cloud Storage: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    this.logger.warn(
      "خدمة التخزين معطّلة — اضبط متغيرات R2 (R2_BUCKET، R2_ENDPOINT، المفاتيح) أو GCS_BUCKET.",
    );
    return null;
  }

  /**
   * يقرأ إعداد R2. المتغيرات الأربعة الأولى إلزامية، وR2_PUBLIC_URL اختياري.
   * أي نقص جزئي يُسجّل بوضوح حتى لا يُقضي المطوّر وقتًا في التخمين.
   */
  private readR2Config(): R2Config | null {
    const bucket = this.str("storage.r2.bucket");
    const endpoint = this.str("storage.r2.endpoint");
    const accessKeyId = this.str("storage.r2.accessKeyId");
    const secretAccessKey = this.str("storage.r2.secretAccessKey");
    const publicUrl = this.str("storage.r2.publicUrl");
    const provided = [bucket, endpoint, accessKeyId, secretAccessKey];
    if (provided.every((value) => value === "")) return null;
    const missing: string[] = [];
    if (!bucket) missing.push("R2_BUCKET");
    if (!endpoint) missing.push("R2_ENDPOINT");
    if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
    if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
    if (missing.length > 0) {
      this.logger.error(
        `إعداد Cloudflare R2 ناقص — المتغيرات المفقودة: ${missing.join(", ")}`,
      );
      return null;
    }
    if (!publicUrl) {
      this.logger.warn(
        "R2_PUBLIC_URL غير مضبوط — ستُستخدم روابط موقّعة مؤقّتة للقراءة.",
      );
    }
    return { bucket, endpoint, accessKeyId, secretAccessKey, publicUrl };
  }

  /** يقرأ إعداد GCS القديم كما هو (لا تُحذف أي ميزة قائمة). */
  private readGcsConfig(): GcsConfig | null {
    const bucket = this.str("gcp.storageBucket");
    if (!bucket) return null;
    return {
      bucket,
      projectId: this.str("gcp.projectId"),
      serviceAccountJson: this.str("gcp.serviceAccountJson"),
    };
  }

  private str(key: string): string {
    return (this.config.get<string>(key) ?? "").trim();
  }

  private ensureDriver(): StorageDriver {
    if (!this.driver) {
      throw new Error(
        "خدمة التخزين معطّلة — اضبط متغيرات Cloudflare R2 (أو GCS_BUCKET).",
      );
    }
    return this.driver;
  }
}
