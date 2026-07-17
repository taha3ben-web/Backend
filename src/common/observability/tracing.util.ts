/**
 * طبقة نقية للتتبّع الموزّع (Distributed Tracing) متوافقة مع W3C Trace Context
 * وOpenTelemetry، بلا اعتماد على أي حزمة خارجية — قابلة لاختبارات الوحدة.
 *
 * صيغة traceparent (W3C): `00-<32 hex traceId>-<16 hex spanId>-<2 hex flags>`
 * هذا يجعل الربط متوافقًا مع أي exporter لـ OpenTelemetry لاحقًا دون تغيير العقد.
 */
import { randomBytes } from "node:crypto";

export const TRACEPARENT_VERSION = "00";
export const FLAG_SAMPLED = 0x01;

export interface TraceParent {
  version: string;
  traceId: string;
  spanId: string;
  flags: number;
}

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const ALL_ZERO_TRACE = "0".repeat(32);
const ALL_ZERO_SPAN = "0".repeat(16);

/** يولّد traceId (128-bit) بـ 32 خانة ستعشرية. */
export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** يولّد spanId (64-bit) بـ 16 خانة ستعشرية. */
export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function isValidTraceId(value: string): boolean {
  return TRACE_ID_RE.test(value) && value !== ALL_ZERO_TRACE;
}

export function isValidSpanId(value: string): boolean {
  return SPAN_ID_RE.test(value) && value !== ALL_ZERO_SPAN;
}

/** يحلّل ترويسة traceparent الواردة؛ يُرجع null إن كانت غير صالحة. */
export function parseTraceparent(
  header: string | string[] | undefined | null,
): TraceParent | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const parts = raw.trim().toLowerCase().split("-");
  if (parts.length < 4) return null;
  const [version, traceId, spanId, flagsHex] = parts;
  if (version.length !== 2 || version === "ff") return null;
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return null;
  const flags = Number.parseInt(flagsHex, 16);
  if (Number.isNaN(flags)) return null;
  return { version: TRACEPARENT_VERSION, traceId, spanId, flags };
}

/** يبني ترويسة traceparent للتمرير إلى الخدمات التالية. */
export function buildTraceparent(args: {
  traceId: string;
  spanId: string;
  sampled?: boolean;
}): string {
  const flags = (args.sampled ?? true) ? FLAG_SAMPLED : 0;
  const flagsHex = flags.toString(16).padStart(2, "0");
  return `${TRACEPARENT_VERSION}-${args.traceId}-${args.spanId}-${flagsHex}`;
}

export function isSampled(flags: number): boolean {
  return (flags & FLAG_SAMPLED) === FLAG_SAMPLED;
}

export type SpanStatus = "OK" | "ERROR" | "UNSET";

export interface SpanRecord {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes?: Record<string, unknown>;
  error?: string;
}

/** يحسب مدّة span بالميلي ثانية (غير سالبة). */
export function spanDurationMs(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs);
}

/**
 * يبني سجلّ span جاهزًا للتصدير (متوافق مع نموذج OTel المبسّط). دالة نقية.
 */
export function buildSpanRecord(args: {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeMs: number;
  endTimeMs: number;
  status?: SpanStatus;
  attributes?: Record<string, unknown>;
  error?: string;
}): SpanRecord {
  const record: SpanRecord = {
    name: args.name,
    traceId: args.traceId,
    spanId: args.spanId,
    startTimeMs: args.startTimeMs,
    endTimeMs: args.endTimeMs,
    durationMs: spanDurationMs(args.startTimeMs, args.endTimeMs),
    status: args.status ?? (args.error ? "ERROR" : "OK"),
  };
  if (args.parentSpanId) record.parentSpanId = args.parentSpanId;
  if (args.attributes && Object.keys(args.attributes).length > 0) {
    record.attributes = args.attributes;
  }
  if (args.error) record.error = args.error;
  return record;
}
