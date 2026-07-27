import { Logger } from "@nestjs/common";
import type { SpanRecord } from "./tracing.util";

/**
 * مُصدّر OTLP/HTTP (JSON) للـ spans — دون حزم خارجية.
 *
 * المُصدّر السابق كان يكتب إلى stdout فقط، وهو كافٍ للقراءة البشرية لكنه لا يعطي
 * شلالات (waterfall) ولا بحثًا بـ traceId في أداة تتبّع. الآن إن ضُبط
 * `OTEL_EXPORTER_OTLP_ENDPOINT` تُدفع الـ spans إلى أي مجمّع متوافق (OTel Collector،
 * Tempo، Jaeger، Honeycomb…) دفعًا مُجمّعًا (batch) لتقليل عدد الطلبات.
 *
 * التصدير بأفضل جهد: أي فشل يُسجّل ولا يؤثر على مسار الطلب.
 */

const NANOS_PER_MS = 1_000_000;

/** يحوّل قيمة عشوائية إلى سمة OTLP (anyValue). دالة نقية. */
export function toOtlpAttribute(
  key: string,
  value: unknown,
): { key: string; value: Record<string, unknown> } {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (value === null || value === undefined) {
    return { key, value: { stringValue: "" } };
  }
  return {
    key,
    value: {
      stringValue: typeof value === "string" ? value : JSON.stringify(value),
    },
  };
}

/** رمز حالة OTLP: 0 UNSET / 1 OK / 2 ERROR. */
export function toOtlpStatusCode(status: SpanRecord["status"]): number {
  if (status === "OK") return 1;
  if (status === "ERROR") return 2;
  return 0;
}

/** يبني حمولة OTLP/JSON كاملة من دفعة spans. دالة نقية قابلة للاختبار. */
export function buildOtlpPayload(
  spans: SpanRecord[],
  serviceName: string,
  serviceRole: string,
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            toOtlpAttribute("service.name", serviceName),
            toOtlpAttribute("service.role", serviceRole),
            toOtlpAttribute(
              "deployment.environment",
              process.env.NODE_ENV ?? "development",
            ),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "nova-inhouse-tracer", version: "1.0" },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 1, // INTERNAL
              startTimeUnixNano: String(s.startTimeMs * NANOS_PER_MS),
              endTimeUnixNano: String(s.endTimeMs * NANOS_PER_MS),
              attributes: Object.entries(s.attributes ?? {}).map(([k, v]) =>
                toOtlpAttribute(k, v),
              ),
              status: s.error
                ? { code: toOtlpStatusCode(s.status), message: s.error }
                : { code: toOtlpStatusCode(s.status) },
            })),
          },
        ],
      },
    ],
  };
}

export class OtlpSpanExporter {
  private readonly logger = new Logger("OtlpExporter");
  private readonly endpoint: string | null;
  private readonly serviceName =
    process.env.OTEL_SERVICE_NAME?.trim() || "nova-backend";
  private readonly serviceRole = process.env.APP_ROLE?.trim() || "all";
  private readonly maxBatch = Math.max(
    1,
    Number(process.env.OTEL_MAX_BATCH ?? 100),
  );
  private readonly flushIntervalMs = Math.max(
    1000,
    Number(process.env.OTEL_FLUSH_INTERVAL_MS ?? 5000),
  );
  private buffer: SpanRecord[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(endpoint?: string | null) {
    const raw = (endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "")
      .trim()
      .replace(/\/+$/, "");
    this.endpoint = raw ? `${raw}/v1/traces` : null;
  }

  get enabled(): boolean {
    return this.endpoint !== null;
  }

  /** يضيف span إلى الدفعة؛ يُفرغ عند امتلاء الدفعة أو بعد المهلة. */
  add(span: SpanRecord): void {
    if (!this.endpoint) return;
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBatch) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
      // لا يمنع إغلاق العملية بسبب مؤقّت مراقبة.
      this.timer.unref?.();
    }
  }

  /** يدفع كل الـ spans المخزّنة الآن (بأفضل جهد). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.endpoint || this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetchFn !== "function") return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        },
        body: JSON.stringify(
          buildOtlpPayload(batch, this.serviceName, this.serviceRole),
        ),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`OTLP رفض الدفعة: ${res.status}`);
      }
    } catch (e) {
      this.logger.warn(
        `تعذر تصدير الـ spans: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** يحلّل `OTEL_EXPORTER_OTLP_HEADERS` بصيغة `k1=v1,k2=v2`. */
export function parseHeaders(raw?: string): Record<string, string> {
  if (!raw?.trim()) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}
