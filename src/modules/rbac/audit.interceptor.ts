import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AuditService } from "./audit.service";

const TRACKED_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * يسجّل كل عملية كتابة ناجحة (POST/PATCH/PUT/DELETE) في سجل التدقيق:
 * من قام بها (actorId)، وقتها، IP، User-Agent، ونوع العملية (المسار).
 * التسجيل fire-and-forget حتى لا يؤثر على زمن الاستجابة.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    if (!TRACKED_METHODS.has(method)) return next.handle();

    const actorId: string | null = req.user?.userId ?? null;
    const originalUrl: string = req.originalUrl || req.url || "";
    const path = originalUrl.split("?")[0];
    const entity = this.extractEntity(path);
    const entityId = this.extractEntityId(req.params);
    const ip = this.extractIp(req);
    const userAgent: string | null = req.headers?.["user-agent"] ?? null;

    return next.handle().pipe(
      tap(() => {
        void this.audit.record({
          actorId,
          action: `${method} ${path}`,
          entity,
          entityId,
          ip,
          userAgent,
        });
      }),
    );
  }

  private extractEntity(path: string): string | null {
    // /api/drivers/:id/approve → "drivers"
    const parts = path.split("/").filter(Boolean);
    const apiIdx = parts.indexOf("api");
    const seg = apiIdx >= 0 ? parts[apiIdx + 1] : parts[0];
    return seg ?? null;
  }

  private extractEntityId(
    params: Record<string, string> | undefined,
  ): string | null {
    if (!params) return null;
    return params.id ?? params.userId ?? params.driverId ?? null;
  }

  private extractIp(req: {
    ip?: string;
    headers?: Record<string, unknown>;
    socket?: { remoteAddress?: string };
  }): string | null {
    const fwd = req.headers?.["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) {
      return fwd.split(",")[0].trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }
}
