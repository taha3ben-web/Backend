import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { RequestContextMiddleware } from "./context.middleware";
import { LoggingInterceptor } from "./logging.interceptor";
import { StructuredLogger } from "./structured-logger.service";
import { TracerService } from "./tracer.service";
import { AlertService } from "./alert.service";

/**
 * طبقة المراقبة (Observability) — معرّفة كـ @Global لأن مكوّناتها
 * عرضانية (cross-cutting):
 *  - middleware سياق الطلب على كل المسارات (requestId/traceId + W3C traceparent).
 *  - Logger مُهيكل + interceptor عام لتسجيل اكتمال الطلبات.
 *  - `TracerService` للتتبّع الموزّع المتوافق مع OpenTelemetry.
 *  - `AlertService` لتوصيل التنبيهات إلى وجهات خارجية.
 */
@Global()
@Module({
  providers: [
    StructuredLogger,
    TracerService,
    AlertService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
  exports: [StructuredLogger, TracerService, AlertService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
