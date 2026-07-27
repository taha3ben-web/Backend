import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { getRequestContext } from "../observability/request-context";
import { ErrorReporterService } from "../observability/error-reporter.service";
import { AppException } from "../api/app.exception";
import {
  ApiErrorCode,
  buildErrorEnvelope,
  codeForHttpStatus,
  resolveLocale,
} from "../api/api-error.util";

/**
 * مُرّشّح استثناءات موحّد لـ HTTP:
 *  - يُسجّل أخطاء الخادم (5xx) مع الـ stack داخليًا فقط.
 *  - يُرجع مغلّف JSON موحّد بـ (code ثابت + رسالة مترجمة حسب Accept-Language)
 *    دون تسريب التفاصيل في الإنتاج.
 * لا يتدخل في سياق WebSocket (تتولّاه الـ Gateway).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  /**
   * مراسل الأخطاء اختياري: المرشّح يُنشأ يدويًا في `main.ts`، فلا نفرضه
   * حتى تبقى الاختبارات الحالية (`new AllExceptionsFilter()`) عاملة دون تعديل.
   */
  constructor(private readonly reporter?: ErrorReporterService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") return;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // الكود الموحّد: من AppException مباشرةً، وإلّا يُشتقّ من حالة HTTP.
    let code: ApiErrorCode;
    let details: unknown;
    let messageOverride: string | undefined;
    if (exception instanceof AppException) {
      code = exception.code;
      details = exception.details;
      messageOverride = exception.messageOverride;
    } else {
      code = codeForHttpStatus(status);
    }

    // لاستثناءات Nest القديمة (BadRequest…): استخرج الرسالة/التفاصيل.
    if (!messageOverride && exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === "string") {
        messageOverride = res;
      } else if (res && typeof res === "object") {
        const msg = (res as Record<string, unknown>).message;
        // رسائل التحقّق (ValidationPipe) تأتي كمصفوفة → details.
        if (Array.isArray(msg)) {
          details = msg;
        } else if (typeof msg === "string") {
          messageOverride = msg;
        }
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // أخطاء الخادم فقط تُرفع للمراقبة (4xx أخطاء عميل وتغرق اللوحة).
      this.reporter?.capture(exception, {
        where: `${request.method} ${request.originalUrl}`,
        method: request.method,
        statusCode: status,
        userId: (request as unknown as { user?: { userId?: string } }).user
          ?.userId,
      });
    } else {
      this.logger.warn(`${request.method} ${request.originalUrl} -> ${status}`);
    }

    const isProd = process.env.NODE_ENV === "production";
    // في الإنتاج لا نسرّب رسائل أخطاء الخادم الداخلية.
    if (status >= 500 && isProd) {
      messageOverride = undefined;
      details = undefined;
    }

    const requestContext = getRequestContext();
    const locale = resolveLocale(
      (request.headers["accept-language"] as string | undefined) ?? undefined,
    );

    const envelope = buildErrorEnvelope({
      code,
      locale,
      messageOverride,
      details,
      path: request.originalUrl,
      requestId: requestContext?.requestId,
      traceId: requestContext?.traceId,
    });

    response.status(status).json(envelope);
  }
}
