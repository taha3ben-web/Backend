import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import {
  generateId,
  normalizeIncomingId,
  runWithRequestContext,
  type RequestContext,
} from "./request-context";
import { buildTraceparent, parseTraceparent } from "./tracing.util";

/**
 * يُنشئ سياق طلب (requestId/traceId) لكل طلب HTTP، يحترم ترويسات الربط
 * الواردة (x-request-id / x-trace-id) إن كانت صالحة، يعيدها في الاستجابة، ثم
 * ينفّذ بقية السلسلة داخل AsyncLocalStorage حتى تلتقطها السجلات تلقائيًا.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incomingRequestId = normalizeIncomingId(req.headers["x-request-id"]);
    const requestId = incomingRequestId ?? generateId();

    // نحترم سياق تتبّع W3C الوارد (traceparent) إن وُجد لربط الطلب
    // عبر الخدمات (متوافق مع OpenTelemetry)، ثم نرجع لـ x-trace-id.
    const incomingTrace = parseTraceparent(req.headers["traceparent"]);
    const traceId =
      incomingTrace?.traceId ??
      normalizeIncomingId(req.headers["x-trace-id"]) ??
      incomingRequestId ??
      requestId;

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-trace-id", traceId);
    // نمرّر traceparent للمراقبة الطرفية في الاستجابة (إذا كان traceId ستعشريًا صالحًا).
    if (/^[0-9a-f]{32}$/.test(traceId)) {
      res.setHeader(
        "traceparent",
        buildTraceparent({
          traceId,
          spanId:
            incomingTrace?.spanId ??
            generateId().replace(/-/g, "").slice(0, 16),
          sampled: true,
        }),
      );
    }

    const ctx: RequestContext = {
      requestId,
      traceId,
      method: req.method,
      path: (req.originalUrl || req.url || "").split("?")[0],
      ip: extractIp(req),
      actorId: null,
    };

    runWithRequestContext(ctx, () => next());
  }
}

function extractIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.ip ?? null;
}
