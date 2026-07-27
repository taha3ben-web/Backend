import { Logger } from "@nestjs/common";
import { PassThrough, Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  joinPublicUrl,
  normalizeObjectPath,
  type StorageDriver,
  type StorageObjectMetadata,
} from "../storage.driver";

/** إعداد R2 المقروء من متغيرات البيئة وحدها — لا قيم ثابتة داخل الكود. */
export type R2Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
};

/** R2 يتجاهل المنطقة لكن SDK يطلبها، والقيمة المتفق عليها لدى Cloudflare هي auto. */
const R2_REGION = "auto";

/**
 * مزوّد تخزين Cloudflare R2 عبر AWS SDK v3 (واجهة R2 متوافقة مع S3).
 * مسؤول عن: الرفع، الحذف، الروابط الموقّعة، الرابط العام، والقراءة المتدفّقة.
 */
export class R2StorageDriver implements StorageDriver {
  readonly provider = "r2" as const;
  readonly bucket: string;
  private readonly logger = new Logger("R2Storage");
  private readonly client: S3Client;
  private readonly publicBaseUrl: string;

  constructor(config: R2Config) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicUrl.trim();
    this.client = new S3Client({
      region: R2_REGION,
      endpoint: config.endpoint,
      // R2 يتطلّب نمط المسار (bucket داخل المسار) لا نمط النطاق الفرعي.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.logger.log(
      `Cloudflare R2 مفعّل (bucket: ${this.bucket}${
        this.publicBaseUrl ? ", نطاق عام مضبوط" : ", دون نطاق عام"
      })`,
    );
  }

  async upload(
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = normalizeObjectPath(objectPath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          CacheControl: "private, max-age=0",
        }),
      );
      return key;
    } catch (error) {
      throw this.wrap("UPLOAD", key, error);
    }
  }

  async signedReadUrl(
    objectPath: string,
    expiresInMinutes: number,
  ): Promise<string> {
    const key = normalizeObjectPath(objectPath);
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: Math.max(1, Math.round(expiresInMinutes * 60)) },
      );
    } catch (error) {
      throw this.wrap("SIGN_READ", key, error);
    }
  }

  async signedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes: number,
  ): Promise<string> {
    const key = normalizeObjectPath(objectPath);
    try {
      return await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: Math.max(1, Math.round(expiresInMinutes * 60)) },
      );
    } catch (error) {
      throw this.wrap("SIGN_UPLOAD", key, error);
    }
  }

  async objectMetadata(objectPath: string): Promise<StorageObjectMetadata> {
    const key = normalizeObjectPath(objectPath);
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentType: head.ContentType ?? "application/octet-stream",
        bytes: Number(head.ContentLength ?? 0),
        etag: String(head.ETag ?? "").replace(/"/g, ""),
      };
    } catch (error) {
      throw this.wrap("HEAD", key, error);
    }
  }

  /**
   * يُرجِع تدفّقًا فورًا (دون await) للحفاظ على نفس توقيع الدالة القديمة
   * فلا يتغير أي موضع استدعاء. أي خطأ يُدمّر التدفّق فيراه المستهلِك.
   */
  readStream(objectPath: string): Readable {
    const key = normalizeObjectPath(objectPath);
    const passthrough = new PassThrough();
    void this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      .then((result) => {
        const body = result.Body as Readable | undefined;
        if (!body || typeof body.pipe !== "function") {
          passthrough.destroy(this.wrap("READ", key, "empty body"));
          return;
        }
        body.on("error", (error: unknown) =>
          passthrough.destroy(this.wrap("READ", key, error)),
        );
        body.pipe(passthrough);
      })
      .catch((error) => passthrough.destroy(this.wrap("READ", key, error)));
    return passthrough;
  }

  async delete(objectPath: string): Promise<void> {
    const key = normalizeObjectPath(objectPath);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      // الحذف في S3/R2 خامل التكرار؛ عدم الوجود لا يُعدّ خطأً.
      const code = (error as { name?: string }).name ?? "";
      if (code === "NoSuchKey" || code === "NotFound") {
        this.logger.warn(`محاولة حذف كائن غير موجود: ${key}`);
        return;
      }
      throw this.wrap("DELETE", key, error);
    }
  }

  publicUrl(objectPath: string): string | null {
    if (!this.publicBaseUrl) return null;
    return joinPublicUrl(this.publicBaseUrl, objectPath);
  }

  /** يلفّ أخطاء المزوّد برسالة موحّدة ويسجّلها دون تسريب المفاتيح. */
  private wrap(operation: string, key: string, error: unknown): Error {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(`R2_${operation}_FAILED للكائن ${key}: ${reason}`);
    return new Error(`R2_${operation}_FAILED`);
  }
}
