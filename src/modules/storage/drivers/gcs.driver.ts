import { Logger } from "@nestjs/common";
import type { Readable } from "node:stream";
import { Storage, type StorageOptions } from "@google-cloud/storage";
import {
  normalizeObjectPath,
  type StorageDriver,
  type StorageObjectMetadata,
} from "../storage.driver";

/** إعداد Google Cloud Storage كما كان قبل إضافة R2 (محفوظ للتوافق الخلفي). */
export type GcsConfig = {
  bucket: string;
  projectId: string;
  serviceAccountJson: string;
};

/**
 * مزوّد Google Cloud Storage — منطقه منقول حرفيًا من StorageService القديمة
 * حتى تبقى الملفات المرفوعة سابقًا مقروءة ولا تفقد أي ميزة قائمة.
 */
export class GcsStorageDriver implements StorageDriver {
  readonly provider = "gcs" as const;
  readonly bucket: string;
  private readonly logger = new Logger("GcsStorage");
  private readonly storage: Storage;

  constructor(config: GcsConfig) {
    this.bucket = config.bucket;
    const options: StorageOptions = {};
    if (config.projectId) options.projectId = config.projectId;
    // خارج Google Cloud (مثل Render) نمرّر بيانات الاعتماد صراحةً
    // لتعمل المصادقة وتوقيع الروابط (v4 signed URLs).
    if (config.serviceAccountJson) {
      try {
        const creds = JSON.parse(config.serviceAccountJson) as {
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
    this.logger.log(`Google Cloud Storage مفعّل (bucket: ${this.bucket})`);
  }

  async upload(
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = normalizeObjectPath(objectPath);
    await this.file(key).save(data, {
      contentType,
      resumable: false,
      metadata: { cacheControl: "private, max-age=0" },
    });
    return key;
  }

  async signedReadUrl(
    objectPath: string,
    expiresInMinutes: number,
  ): Promise<string> {
    const [url] = await this.file(normalizeObjectPath(objectPath)).getSignedUrl(
      {
        version: "v4",
        action: "read",
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      },
    );
    return url;
  }

  async signedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes: number,
  ): Promise<string> {
    const [url] = await this.file(normalizeObjectPath(objectPath)).getSignedUrl(
      {
        version: "v4",
        action: "write",
        contentType,
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      },
    );
    return url;
  }

  async objectMetadata(objectPath: string): Promise<StorageObjectMetadata> {
    const [metadata] = await this.file(
      normalizeObjectPath(objectPath),
    ).getMetadata();
    return {
      contentType: metadata.contentType ?? "application/octet-stream",
      bytes: Number(metadata.size ?? 0),
      etag: String(
        metadata.md5Hash ?? metadata.etag ?? metadata.generation ?? "",
      ),
    };
  }

  readStream(objectPath: string): Readable {
    return this.file(normalizeObjectPath(objectPath)).createReadStream();
  }

  async delete(objectPath: string): Promise<void> {
    await this.file(normalizeObjectPath(objectPath)).delete({
      ignoreNotFound: true,
    });
  }

  /** GCS هنا خاص دائمًا ويُقرأ بروابط موقّعة، فلا رابط عام ثابت. */
  publicUrl(): string | null {
    return null;
  }

  private file(key: string) {
    return this.storage.bucket(this.bucket).file(key);
  }
}
