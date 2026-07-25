import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage, type StorageOptions } from "@google-cloud/storage";

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
    const serviceAccountJson = this.config.get<string>(
      "gcp.serviceAccountJson",
    );
    if (bucket) {
      this.bucketName = bucket;
      const options: StorageOptions = {};
      if (projectId) options.projectId = projectId;
      // على Render (خارج Google Cloud) نمرّر بيانات اعتماد حساب الخدمة
      // صراحةً حتى تعمل المصادقة وتوقيع الروابط (v4 signed URLs).
      if (serviceAccountJson) {
        try {
          const creds = JSON.parse(serviceAccountJson) as {
            client_email?: string;
            private_key?: string;
            project_id?: string;
          };
          if (creds.client_email && creds.private_key) {
            options.credentials = {
              client_email: creds.client_email,
              private_key: creds.private_key.replace(/\\n/g, "\n"),
            };
            if (!options.projectId && creds.project_id) {
              options.projectId = creds.project_id;
            }
          } else {
            this.logger.warn(
              "GCP_SERVICE_ACCOUNT_JSON ناقص (client_email/private_key).",
            );
          }
        } catch {
          this.logger.error("GCP_SERVICE_ACCOUNT_JSON ليس JSON صالحًا.");
        }
      }
      this.storage = new Storage(options);
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
    const file = this.getBucket().file(objectPath);
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
    const [url] = await this.getBucket()
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
    const [url] = await this.getBucket()
      .file(objectPath)
      .getSignedUrl({
        version: "v4",
        action: "write",
        contentType,
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });
    return url;
  }

  async objectMetadata(objectPath: string): Promise<{ contentType: string; bytes: number; etag: string }> { this.ensureEnabled(); const [m] = await this.getBucket().file(objectPath).getMetadata(); return { contentType: m.contentType ?? "application/octet-stream", bytes: Number(m.size ?? 0), etag: String(m.md5Hash ?? m.etag ?? m.generation ?? "") }; }
  readStream(objectPath: string) { this.ensureEnabled(); return this.getBucket().file(objectPath).createReadStream(); }

  /** يحذف ملفًا من الـ bucket (يتجاهل إن لم يوجد). */
  async delete(objectPath: string): Promise<void> {
    this.ensureEnabled();
    await this.getBucket()
      .file(objectPath)
      .delete({ ignoreNotFound: true });
  }

  private getBucket() {
    if (!this.storage || !this.bucketName) throw new Error("خدمة Cloud Storage معطّلة — اضبط GCS_BUCKET وبيانات الاعتماد.");
    return this.storage.bucket(this.bucketName);
  }

  private ensureEnabled(): void {
    if (!this.isEnabled()) {
      throw new Error(
        "خدمة Cloud Storage معطّلة — اضبط GCS_BUCKET وبيانات الاعتماد.",
      );
    }
  }
}
