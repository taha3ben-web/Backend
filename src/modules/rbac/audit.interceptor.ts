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
const REDACTED_VALUE = "[REDACTED]";

/**
 * يسجّل كل عملية كتابة ناجحة (POST/PATCH/PUT/DELETE) في سجل التدقيق:
 * من قام بها (actorId)، وقتها، IP، User-Agent، ونوع العملية (المسار).
 * يضيف كذلك params/query/body بعد تنظيفها من القيم الحساسة حتى يصبح
 * سجل التدقيق مفيدًا في التتبع والتحقيق دون كشف كلمات المرور أو الرموز.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
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
      tap((responseBody: unknown) => {
        const responseEntityId = this.extractResponseEntityId(responseBody);
        void this.audit.record({
          actorId,
          action: `${method} ${path}`,
          entity,
          entityId: entityId ?? responseEntityId,
          ip,
          userAgent,
          meta: {
            statusCode: res?.statusCode ?? null,
            params: this.sanitizeForAudit(req.params ?? null),
            query: this.sanitizeForAudit(req.query ?? null),
            body: this.sanitizeBodyForPath(path, req.body ?? null),
          },
        });
      }),
    );
  }

  private extractEntity(path: string): string | null {
    const parts = path.split("/").filter(Boolean);
    const apiIdx = parts.indexOf("api");
    const seg = apiIdx >= 0 ? parts[apiIdx + 1] : parts[0];
    return seg ?? null;
  }

  private extractResponseEntityId(responseBody: unknown): string | null {
    if (!responseBody || typeof responseBody !== "object") return null;
    const id = (responseBody as Record<string, unknown>).id;
    return typeof id === "string" && id.length > 0 ? id : null;
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

  private sanitizeBodyForPath(path: string, body: unknown): unknown {
    const sanitized = this.sanitizeForAudit(body);
    if (!path.includes("/settings")) return sanitized;
    if (
      !sanitized ||
      typeof sanitized !== "object" ||
      Array.isArray(sanitized)
    ) {
      return sanitized;
    }

    const output = { ...(sanitized as Record<string, unknown>) };
    if ("value" in output) output.value = REDACTED_VALUE;
    if (Array.isArray(output.items)) {
      output.items = output.items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          return item;
        return { ...(item as Record<string, unknown>), value: REDACTED_VALUE };
      });
    }
    return output;
  }

  private sanitizeForAudit(value: unknown, depth = 0): unknown {
    if (depth > 5) return "[DEPTH_LIMIT]";
    if (value === undefined || value === null) return null;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, 50)
        .map((item) => this.sanitizeForAudit(item, depth + 1));
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return `[BUFFER:${value.length}]`;
    }
    if (typeof value === "object") {
      const source = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(source).slice(0, 50)) {
        if (this.isSensitiveKey(key)) {
          output[key] = REDACTED_VALUE;
          continue;
        }
        const sanitized = this.sanitizeForAudit(item, depth + 1);
        output[key] = sanitized ?? null;
      }
      return output;
    }
    return String(value);
  }

  private isSensitiveKey(key: string): boolean {
    return /password|token|secret|authorization|cookie|idToken/i.test(key);
  }
}
