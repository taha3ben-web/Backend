import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { loadSecretsIntoEnv } from "./config/secrets";
import { RedisIoAdapter } from "./realtime-redis.adapter";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

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
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // خلف بروكسي/Load Balancer → يجعل req.ip يعكس IP العميل الحقيقي.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", 1);
  expressApp.disable("x-powered-by");

  // ترويسات أمنية
  app.use(helmet());

  // حدود حجم الطلب (تحمي من الحمولات الضخمة)
  app.use(json({ limit: "1mb" }));
  app.use(urlencoded({ extended: true, limit: "1mb" }));

  // CORS — قائمة سماح من البيئة (CORS_ORIGINS مفصولة بفواصل).
  // إن لم تُضبط يُسمح للجميع دون اعتمادات (مناسب للتطوير).
  const origins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length) {
    app.enableCors({ origin: origins, credentials: true });
  } else {
    app.enableCors({ origin: "*" });
  }

  app.setGlobalPrefix("api");

  // تحقق مدخلات شامل (يرفض الحقول غير المعرّفة + يحوّل الأنواع)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // مُرشّح استثناءات موحّد (تسجيل داخلي + استجابة نظيفة).
  app.useGlobalFilters(new AllExceptionsFilter());

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

void bootstrap();
