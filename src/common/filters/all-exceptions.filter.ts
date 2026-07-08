import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * مُرشّح استثناءات موحّد لـ HTTP:
 *  - يُسجّل أخطاء الخادم (5xx) مع الـ stack داخليًا فقط.
 *  - يُرجع استجابة JSON متسقة دون تسريب التفاصيل في الإنتاج.
 * لا يتدخل في سياق WebSocket (تتولّاه الـ Gateway).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") return;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown = "Internal server error";
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      message =
        typeof res === "string"
          ? res
          : ((res as Record<string, unknown>)?.message ?? res);
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.originalUrl} -> ${status}`,
      );
    }

    const isProd = process.env.NODE_ENV === "production";
    response.status(status).json({
      statusCode: status,
      error: status >= 500 && isProd ? "Internal server error" : message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }
}
