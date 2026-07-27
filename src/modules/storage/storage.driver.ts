import type { Readable } from "node:stream";

/**
 * عقد موحّد لكل مزوّدات التخزين (Cloudflare R2 أو Google Cloud Storage).
 * يسمح بتبديل المزوّد من متغيرات البيئة دون أي تعديل في الخدمات المستهلكة.
 */
export type StorageProviderName = "r2" | "gcs";

/** وصف كائن مخزّن (يُستخدم للتحقّق بعد الرفع المباشر). */
export type StorageObjectMetadata = {
  contentType: string;
  bytes: number;
  etag: string;
};

export interface StorageDriver {
  /** اسم المزوّد للسجلات والمراقبة. */
  readonly provider: StorageProviderName;
  /** اسم الحاوية (bucket) المفعّلة. */
  readonly bucket: string;
  /** يرفع محتوى من الخادم ويُرجِع مسار الكائن. */
  upload(
    objectPath: string,
    data: Buffer,
    contentType: string,
  ): Promise<string>;
  /** رابط قراءة موقّع مؤقّت. */
  signedReadUrl(objectPath: string, expiresInMinutes: number): Promise<string>;
  /** رابط رفع موقّع (PUT) للرفع المباشر من التطبيق. */
  signedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes: number,
  ): Promise<string>;
  /** وصف الكائن (النوع، الحجم، etag). */
  objectMetadata(objectPath: string): Promise<StorageObjectMetadata>;
  /** تدفّق قراءة متزامن التوقيع (لتمريره مباشرة إلى الرد). */
  readStream(objectPath: string): Readable;
  /** يحذف الكائن ويتجاهل عدم وجوده. */
  delete(objectPath: string): Promise<void>;
  /**
   * الرابط العام للكائن إن كان النطاق العام مضبوطًا، وإلا null
   * (فيتراجع المستهلِك إلى رابط موقّع مؤقّت).
   */
  publicUrl(objectPath: string): string | null;
}

/** ينزع الشرطة المائلة البادئة ليبقى مسار الكائن متسقًا بين المزوّدين. */
export function normalizeObjectPath(objectPath: string): string {
  const trimmed = objectPath.trim().replace(/^\/+/, "");
  if (!trimmed) throw new Error("STORAGE_OBJECT_PATH_EMPTY");
  if (trimmed.includes("..")) throw new Error("STORAGE_OBJECT_PATH_INVALID");
  return trimmed;
}

/** يبني رابطًا عامًا من نطاق مضبوط + مسار الكائن، دون شرطات مكررة. */
export function joinPublicUrl(
  publicBaseUrl: string,
  objectPath: string,
): string {
  const base = publicBaseUrl.trim().replace(/\/+$/, "");
  const path = normalizeObjectPath(objectPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${path}`;
}
