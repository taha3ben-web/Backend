import { Logger } from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/**
 * تحميل الأسرار من Google Secret Manager قبل إقلاع التطبيق.
 *
 * الفكرة: بدل وضع المفاتيح السرية في متغيرات البيئة مباشرة،
 * نضع فقط أسماء الأسرار في Secret Manager ونقرأها عند الإقلاع.
 *
 * التفعيل: اضبط USE_SECRET_MANAGER=true و GCP_PROJECT_ID.
 * لكل مفتاح، يُقرأ من السر ذي الاسم نفسه (بأحرف صغيرة وشرطات).
 * إذا فشل أي سر يُترك متغير البيئة الحالي كما هو.
 */

const logger = new Logger("SecretManager");

// المفاتيح السرية التي نحاول تحميلها من Secret Manager.
const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FCM_SERVER_KEY",
];

/** يحوّل DATABASE_URL → database-url لاسم السر في Secret Manager. */
function toSecretName(envKey: string): string {
  return envKey.toLowerCase().replace(/_/g, "-");
}

export async function loadSecretsIntoEnv(): Promise<void> {
  if (process.env.USE_SECRET_MANAGER !== "true") return;

  const projectId =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    logger.warn("USE_SECRET_MANAGER=true لكن GCP_PROJECT_ID غير مضبوط.");
    return;
  }

  const client = new SecretManagerServiceClient();
  let loaded = 0;

  for (const envKey of SECRET_ENV_KEYS) {
    const secretName = toSecretName(envKey);
    try {
      const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
      });
      const payload = version.payload?.data?.toString();
      if (payload) {
        process.env[envKey] = payload;
        loaded += 1;
      }
    } catch {
      // السر غير موجود أو لا صلاحية؛ نبقي قيمة البيئة الحالية.
    }
  }

  logger.log(`تم تحميل ${loaded} سرًا من Secret Manager.`);
}
