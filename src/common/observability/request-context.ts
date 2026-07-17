import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * سياق الطلب الحامل لحقول الربط (correlation) عبر عمر الطلب الواحد.
 */
export interface RequestContext {
  requestId: string;
  traceId: string;
  actorId?: string | null;
  method?: string;
  path?: string;
  ip?: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** ينفّذ الدالة داخل سياق طلب معزول حتى تلتقطه السجلات تلقائيًا. */
export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T,
): T {
  return storage.run(ctx, fn);
}

/** يعيد سياق الطلب الحالي إن وُجد. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** يضبط قيمة على السياق الحالي إن وُجد (مثل actorId بعد المصادقة). */
export function setContextValue<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K],
): void {
  const store = storage.getStore();
  if (store) store[key] = value;
}

/** يولّد مُعرّف ربط (correlation id) جديدًا. */
export function generateId(): string {
  return randomUUID();
}

/**
 * يطبّع مُعرّفًا واردًا من ترويسة الطلب: يقبل قيمة قصيرة نظيفة فقط
 * (حتى لا يُحقن عميل مُعرّفًا ضخمًا أو مُلوّثًا في السجلات).
 */
export function normalizeIncomingId(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return undefined;
  return /^[\w.\-:]+$/.test(trimmed) ? trimmed : undefined;
}

export type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

/** سجل لوق مُهيكل جاهز للتحويل إلى JSON. */
export interface StructuredLogRecord {
  level: LogLevel;
  time: string;
  message: string;
  context?: string;
  requestId?: string;
  traceId?: string;
  actorId?: string | null;
  method?: string;
  path?: string;
  stack?: string;
}

/**
 * يبني سجل لوق مُهيكل من الرسالة وسياق الطلب. دالة نقية قابلة للاختبار.
 */
export function buildLogRecord(args: {
  level: LogLevel;
  message: string;
  context?: string;
  stack?: string;
  requestContext?: RequestContext;
  now?: Date;
}): StructuredLogRecord {
  const { level, message, context, stack, requestContext, now } = args;
  const record: StructuredLogRecord = {
    level,
    time: (now ?? new Date()).toISOString(),
    message,
  };
  if (context) record.context = context;
  if (requestContext) {
    record.requestId = requestContext.requestId;
    record.traceId = requestContext.traceId;
    if (requestContext.actorId != null) {
      record.actorId = requestContext.actorId;
    }
    if (requestContext.method) record.method = requestContext.method;
    if (requestContext.path) record.path = requestContext.path;
  }
  if (stack) record.stack = stack;
  return record;
}
