import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { getRequestContext, setContextValue } from "./request-context";
import { recordHttpRequest } from "./http-metrics";

/**
 * يسجّل اكتمال كل طلب HTTP (المدة + رمز الحالة) مع حقول الربط، ويضبط
 * actorId على السياق فور توفّره بعد المصادقة حتى تحمله بقية سجلات الطلب.
 *
 * ويغذّي أيضًا سجل مقاييس HTTP الذي تقرأه نقطة `/api/metrics`. وُضع هنا لأنه
 * مسجّل كـ `APP_INTERCEPTOR` عالمي، فيمرّ به كل طلب دون تعديل أي متحكم.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const actorId: string | null = req.user?.userId ?? null;
    if (actorId) setContextValue("actorId", actorId);

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.logCompletion(req, res, start),
        error: () => this.logCompletion(req, res, start),
      }),
    );
  }

  private logCompletion(
    req: { method?: string; originalUrl?: string },
    res: { statusCode?: number },
    start: number,
  ): void {
    const ctx = getRequestContext();
    const durationMs = Date.now() - start;
    const path = ctx?.path ? ` ${ctx.path}` : "";
    this.logger.log(
      `${req.method ?? "?"} -> ${res.statusCode ?? "?"} ${durationMs}ms${path}`,
    );

    // قياس بأفضل جهد: خلل في المقاييس لا يجوز أن يُسقط استجابة حقيقية.
    try {
      recordHttpRequest({
        method: req.method,
        path: ctx?.path ?? req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      });
    } catch {
      // متجاهَل عمدًا.
    }
  }
}
