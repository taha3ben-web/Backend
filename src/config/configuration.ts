export default () => ({
  port: parseInt(process.env.PORT ?? "4000", 10),
  companyCommission: parseFloat(process.env.COMPANY_COMMISSION ?? "0.15"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret",
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  },
  // Firebase Admin — للتحقق من رموز Firebase ID (جسر الهوية) وإرسال FCM.
  // إذا بقيت فارغة، يعمل الخادم طبيعيًا لكن جسر Firebase يبقى معطّلًا.
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? "",
    // المفتاح الخاص يحتوي على \n حرفية في env → نستبدلها بأسطر حقيقية.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
  // Google Cloud — التخزين + Secret Manager + المشروع.
  // إذا بقيت فارغة تعمل الخدمات المعتمِدة عليها بوضع معطّل بأمان.
  gcp: {
    projectId:
      process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "",
    storageBucket: process.env.GCS_BUCKET ?? "",
    useSecretManager: process.env.USE_SECRET_MANAGER === "true",
  },
  notifications: {
    // Push — Firebase Cloud Messaging (HTTP v1) عبر Firebase Admin SDK.
    // يستخدم بيانات اعتماد firebase.* (لا حاجة لـ FCM_SERVER_KEY القديم).
    // SMS — مزوّد HTTP عام (مثل Twilio أو بوابة محلية)
    sms: {
      apiUrl: process.env.SMS_API_URL ?? "",
      apiKey: process.env.SMS_API_KEY ?? "",
      sender: process.env.SMS_SENDER ?? "NOVA",
    },
    // Email — مزوّد HTTP عام (مثل Resend / SendGrid)
    email: {
      apiUrl: process.env.EMAIL_API_URL ?? "",
      apiKey: process.env.EMAIL_API_KEY ?? "",
      from: process.env.EMAIL_FROM ?? "NOVA Ride <no-reply@novaride.app>",
    },
  },
});
