import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";

/**
 * خدمة تخزين الملفات على Google Cloud Storage.
 * تُستخدم لوثائق السائقين، صور المركبات، الفواتير، والتقارير.
 *
 * المصادقة: على Cloud Run / GCE تُستخدم هوية الخدمة تلقائيًا
 * (Application Default Credentials)؛ محليًا عبر GOOGLE_APPLICATION_CREDENTIALS.
 *
 * إذا لم يُضبط GCS_BUCKET تبقى الخدمة معطّلة بأمان (isEnabled=false).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private storage: Storage | null = null;
  private bucketName: string | null = null;

  constructor(private readonly config: ConfigService) {
    const bucket = this.config.get<string>("gcp.storageBucket");
    const projectId = this.config.get<string>("gcp.projectId");
    if (bucket) {
      this.bucketName = bucket;
      this.storage = new Storage(projectId ? { projectId } : {});
      this.logger.log(`Cloud Storage enabled (bucket: ${bucket})`);
    } else {
      this.logger.warn("GCS_BUCKET غير مضبوط — خدمة التخزين معطّلة.");
    }
  }

  isEnabled(): boolean {
    return this.storage !== null && this.bucketName !== null;
  }

  /**
   * يرفع ملفًا إلى الـ bucket ويُرجِع مساره الداخلي (object path).
   */
  async upload(
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    this.ensureEnabled();
    const file = this.storage!.bucket(this.bucketName!).file(objectPath);
    await file.save(data, {
      contentType,
      resumable: false,
      metadata: { cacheControl: "private, max-age=0" },
    });
    return objectPath;
  }

  /**
   * يُنشئ رابطًا موقّعًا مؤقتًا للقراءة (افتراضيًا 15 دقيقة).
   * مناسب للوثائق الحساسة دون جعل الـ bucket عامًا.
   */
  async signedReadUrl(
    objectPath: string,
    expiresInMinutes = 15,
  ): Promise<string> {
    this.ensureEnabled();
    const [url] = await this.storage!.bucket(this.bucketName!)
      .file(objectPath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });
    return url;
  }

  /**
   * يُنشئ رابطًا موقّعًا للرفع المباشر من التطبيق (PUT) دون مرور الملف بالخادم.
   */
  async signedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes = 15,
  ): Promise<string> {
    this.ensureEnabled();
    const [url] = await this.storage!.bucket(this.bucketName!)
      .file(objectPath)
      .getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });
    return url;
  }

  /** يحذف ملفًا من الـ bucket (يتجاهل إن لم يوجد). */
  async delete(objectPath: string): Promise<void> {
    this.ensureEnabled();
    await this.storage!.bucket(this.bucketName!)
      .file(objectPath)
      .delete({ ignoreNotFound: true });
  }

  private ensureEnabled(): void {
    if (!this.isEnabled()) {
      throw new Error(
        "خدمة Cloud Storage معطّلة — اضبط GCS_BUCKET وبيانات الاعتماد.",
      );
    }
  }
}
