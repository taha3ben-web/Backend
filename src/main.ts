import { NestFactory } from "@nestjs/core";
import {
  ValidationPipe,
  Logger,
  VersioningType,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { loadSecretsIntoEnv } from "./config/secrets";
import { RedisIoAdapter } from "./realtime-redis.adapter";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { StructuredLogger } from "./common/observability/structured-logger.service";
import { resolveCorsOptions } from "./common/security/cors-origins";
import { ErrorReporterService } from "./common/observability/error-reporter.service";

async function bootstrap(): Promise<void> {
  // تحميل الأسرار من Google Secret Manager قبل إقلاع التطبيق (إن كان مُفعّلًا).
  await loadSecretsIntoEnv();

  const isProd = process.env.NODE_ENV === "production";

  // في الإنتاج: ارفض الإقلاع إذا غابت أسرار أو إعدادات الحماية الأساسية.
  if (isProd) {
    const weak = (
      [
        ["JWT_ACCESS_SECRET", process.env.JWT_ACCESS_SECRET],
        ["JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET],
      ] as Array<[string, string | undefined]>
    ).filter(
      ([, v]) => !v || v.startsWith("change-me") || v.startsWith("dev-"),
    );
    if (weak.length) {
      throw new Error(
        `أسرار JWT غير مضبوطة في الإنتاج: ${weak.map(([k]) => k).join(", ")}`,
      );
    }

    const requiredProductionValues = [
      "DATABASE_URL",
      "REDIS_URL",
      "CORS_ORIGINS",
      "PAYMENT_WEBHOOK_TOKEN",
      "METRICS_TOKEN",
    ].filter((key) => !process.env[key]?.trim());
    if (requiredProductionValues.length) {
      throw new Error(
        `إعدادات إنتاج إلزامية غير مضبوطة: ${requiredProductionValues.join(", ")}`,
      );
    }

    if (process.env.CORS_ORIGINS?.trim() === "*") {
      throw new Error("CORS_ORIGINS لا يمكن أن تكون * في الإنتاج");
    }
  }

  // نعطّل محلّل الجسم الافتراضي لنضبط حدود الحجم بأنفسنا.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });

  // Logger مُهيكل (JSON) يضخّ حقول الربط requestId/traceId/actorId مع كل سطر.
  app.useLogger(app.get(StructuredLogger));

  // خلف بروكسي/Load Balancer → يجعل req.ip يعكس IP العميل الحقيقي.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", 1);
  expressApp.disable("x-powered-by");

  // ترويسات أمنية
  app.use(helmet());

  // حدود حجم الطلب (تحمي من الحمولات الضخمة).
  // `verify` تحفظ الجسم الخام (rawBody) لتوقيع الـ webhooks: توقيع HMAC يجب أن
  // يُحسب على البايتات كما وصلت حرفيًا، لا على JSON مُعاد التسلسل، وإلا يمكن
  // تمرير حمولة مختلفة بنفس التوقيع (اختلاف ترتيب المفاتيح أو المسافات).
  app.use(
    json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: "1mb" }));

  // CORS — مصدر موحّد مع WebSocket (resolveCorsOptions). قائمة سماح من
  // البيئة (CORS_ORIGINS مفصولة بفواصل) مع اعتمادات؛ وإلا يُسمح للجميع بلا
  // اعتمادات في التطوير فقط (الإنتاج يمنع غيابها أعلاه).
  app.enableCors(resolveCorsOptions(process.env.CORS_ORIGINS, isProd));

  app.setGlobalPrefix("api");

  // إصدار صارم لـ API عبر المسار (مثل /api/v1/...). نجعل الإصدار
  // الافتراضي يشمل "1" والمحايد (VERSION_NEUTRAL) معًا فتبقى المسارات
  // القديمة (بلا إصدار) تعمل دون كسر، وتتوفّر أيضًا تحت v1 للموبايل.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: ["1", VERSION_NEUTRAL],
    prefix: "v",
  });

  // تحقق مدخلات شامل (يرفض الحقول غير المعرّفة + يحوّل الأنواع)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // توثيق OpenAPI تفاعلي (Swagger UI). يُفعّل تلقائيًا خارج الإنتاج، وفي
  // الإنتاج فقط عند ضبط ENABLE_SWAGGER=true (كي لا نكشف سطح الـ API افتراضيًا).
  if (!isProd || process.env.ENABLE_SWAGGER === "true") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("NOVA Ride API")
      .setDescription(
        "توثيق OpenAPI لواجهة NOVA. البادئة /api؛ وكل المسارات متاحة أيضًا تحت /api/v1.",
      )
      .setVersion("1.0.0")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        "bearerAuth",
      )
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, swaggerDocument, {
      swaggerOptions: { persistAuthorization: true },
    });
    Logger.log("Swagger UI متاح على /api/docs", "Bootstrap");
  }

  // مُرشّح استثناءات موحّد (تسجيل داخلي + استجابة نظيفة).
  const errorReporter = app.get(ErrorReporterService);
  app.useGlobalFilters(new AllExceptionsFilter(errorReporter));

  // أخطاء خارج دورة الطلب (مهام cron، أحداث socket، وعود منسية) لا يراها
  // المُرشّح أبدًا، وكانت تضيع في السجل دون تنبيه. الآن تُرفع للمراقبة.
  process.on("unhandledRejection", (reason) => {
    Logger.error(`unhandledRejection: ${String(reason)}`, "Process");
    errorReporter.capture(reason, { where: "unhandledRejection" });
  });
  process.on("uncaughtException", (error) => {
    Logger.error(`uncaughtException: ${error.message}`, error.stack, "Process");
    errorReporter.capture(error, { where: "uncaughtException" });
  });

  // إيقاف سلس: يُغلق Prisma/Redis واتصالات Socket عند SIGTERM (Cloud Run).
  app.enableShutdownHooks();

  // Socket.IO Redis adapter — يدعم تشغيل عدة نسخ خلف Load Balancer.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, "0.0.0.0");
  Logger.log(`NOVA backend running on port ${port} (prefix /api)`, "Bootstrap");
}

bootstrap().catch((err) => {
  // اطبع سبب الانهيار الحقيقي دائمًا (حتى لو وقع أثناء تهيئة الوحدات قبل
  // ضبط Logger)، ثم اخرج بكود فشل حتى يظهر الخطأ في سجلّ Render بوضوح.
  // eslint-disable-next-line no-console
  console.error("FATAL bootstrap error:", err);
  process.exit(1);
});
