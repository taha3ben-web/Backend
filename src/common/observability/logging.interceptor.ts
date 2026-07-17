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

/**
 * يسجّل اكتمال كل طلب HTTP (المدة + رمز الحالة) مع حقول الربط، ويضبط
 * actorId على السياق فور توفّره بعد المصادقة حتى تحمله بقية سجلات الطلب.
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
    req: { method?: string },
    res: { statusCode?: number },
    start: number,
  ): void {
    const ctx = getRequestContext();
    const durationMs = Date.now() - start;
    const path = ctx?.path ? ` ${ctx.path}` : "";
    this.logger.log(
      `${req.method ?? "?"} -> ${res.statusCode ?? "?"} ${durationMs}ms${path}`,
    );
  }
}
