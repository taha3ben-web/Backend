import { Injectable } from "@nestjs/common";
import {
  buildSpanRecord,
  generateSpanId,
  generateTraceId,
  type SpanRecord,
  type SpanStatus,
} from "./tracing.util";
import { getRequestContext } from "./request-context";

/** مقبض span نشط يُنهى بـ end(). */
export interface ActiveSpan {
  traceId: string;
  spanId: string;
  setAttribute(key: string, value: unknown): void;
  end(outcome?: { status?: SpanStatus; error?: unknown }): SpanRecord;
}

/**
 * خدمة تتبّع خفيفة متوافقة مع OpenTelemetry (W3C Trace Context): تُنشئ spans
 * ترث الـ traceId من سياق الطلب، وتُصدّرها كـ JSON مُهيكل (span record).
 * لا تعتمد على حزم خارجية؛ يمكن لاحقًا إبدال المُصدّر بـ OTLP exporter حقيقي
 * دون تغيير مواقع الاستدعاء (نفس العقد).
 */
@Injectable()
export class TracerService {
  private readonly enabled = process.env.TRACING_ENABLED !== "false";

  /** يبدأ span جديدًا يرث traceId من سياق الطلب (أو يولّده إن غاب). */
  startSpan(name: string, attributes?: Record<string, unknown>): ActiveSpan {
    const ctx = getRequestContext();
    const traceId = normalizeTraceId(ctx?.traceId) ?? generateTraceId();
    const spanId = generateSpanId();
    const startTimeMs = Date.now();
    const attrs: Record<string, unknown> = { ...(attributes ?? {}) };
    if (ctx?.requestId) attrs.requestId = ctx.requestId;
    if (ctx?.actorId) attrs.actorId = ctx.actorId;

    const emit = this.emit.bind(this);

    return {
      traceId,
      spanId,
      setAttribute(key: string, value: unknown): void {
        attrs[key] = value;
      },
      end(outcome): SpanRecord {
        const error =
          outcome?.error instanceof Error
            ? outcome.error.message
            : outcome?.error != null
              ? String(outcome.error)
              : undefined;
        const record = buildSpanRecord({
          name,
          traceId,
          spanId,
          startTimeMs,
          endTimeMs: Date.now(),
          status: outcome?.status,
          attributes: attrs,
          error,
        });
        emit(record);
        return record;
      },
    };
  }

  /**
   * ينفّذ دالة داخل span، ويضمن إنهاءه دائمًا (نجاحًا أو خطأً).
   */
  async withSpan<T>(
    name: string,
    fn: (span: ActiveSpan) => Promise<T>,
    attributes?: Record<string, unknown>,
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn(span);
      span.end({ status: "OK" });
      return result;
    } catch (error) {
      span.end({ status: "ERROR", error });
      throw error;
    }
  }

  private emit(record: SpanRecord): void {
    if (!this.enabled) return;
    // المُصدّر الحالي: stdout بصيغة JSON مُهيكلة (يلتقطها جامع السجلات).
    // يمكن إبداله بـ OTLP HTTP exporter دون تغيير المستدعين.
    process.stdout.write(`${JSON.stringify({ type: "span", ...record })}\n`);
  }
}

function normalizeTraceId(value?: string): string | undefined {
  if (!value) return undefined;
  // سياق الطلب قد يحمل UUID أو traceId ستعشري، نقبله كما هو للربط.
  return value;
}
