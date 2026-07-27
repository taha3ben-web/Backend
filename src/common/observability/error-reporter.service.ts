import { Injectable, Logger } from "@nestjs/common";
import { getRequestContext } from "./request-context";

/**
 * مراسل الأخطاء (Sentry) دون أي حزمة خارجية.
 *
 * لماذا لا نستخدم `@sentry/node`: الـ SDK يُرفق ترقيعات (monkey patching) للـ http
 * والـ async hooks ويزيد وزن الصورة، ونحن نحتاج شيئًا واحدًا: إرسال الخطأ
 * مع سياقه إلى واجهة Sentry Envelope. دالة `fetch` المدمجة تكفي.
 *
 * التفعيل: `SENTRY_DSN=https://<publicKey>@<host>/<projectId>`.
 * إن غاب الـ DSN تعمل الخدمة بوضع التسجيل المحلي فقط (لا ترمي ولا تعطّل شيئًا).
 */

export interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
  path: string;
}

/** يحلّل رابط Sentry DSN إلى مكوناته (دالة نقية — قابلة للاختبار). */
export function parseSentryDsn(dsn?: string | null): ParsedDsn | null {
  const raw = dsn?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const publicKey = url.username;
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      host: url.host,
      projectId,
      protocol: url.protocol.replace(":", ""),
      path: segments.length ? `/${segments.join("/")}` : "",
    };
  } catch {
    return null;
  }
}

/** رابط استقبال الأحداق (envelope endpoint). */
export function sentryEnvelopeUrl(dsn: ParsedDsn): string {
  return `${dsn.protocol}://${dsn.host}${dsn.path}/api/${dsn.projectId}/envelope/`;
}

export interface ErrorReportContext {
  /** مسار الطلب أو اسم المهمة المجدولة. */
  where?: string;
  method?: string;
  statusCode?: number;
  userId?: string;
  extra?: Record<string, unknown>;
}

@Injectable()
export class ErrorReporterService {
  private readonly logger = new Logger("ErrorReporter");
  private readonly dsn = parseSentryDsn(process.env.SENTRY_DSN);
  private readonly environment =
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV ||
    "development";
  private readonly release = process.env.SENTRY_RELEASE?.trim() || undefined;
  private readonly serverName = process.env.APP_ROLE?.trim() || "all";
  /** معدل الأخطاء المرسلة في الدقيقة (حماية من عاصفة أخطاء). */
  private readonly maxPerMinute = Math.max(
    1,
    Number(process.env.SENTRY_MAX_EVENTS_PER_MINUTE ?? 60),
  );
  private windowStartedAt = Date.now();
  private sentInWindow = 0;

  get enabled(): boolean {
    return this.dsn !== null;
  }

  /**
   * يُبلّغ عن خطأ بأفضل جهد: لا يرمي أبدًا ولا يحجز المستدعي، لأن فشل المراقبة
   * لا يجوز أن يُسقط طلبًا حقيقيًا.
   */
  capture(error: unknown, context: ErrorReportContext = {}): void {
    if (!this.dsn) return;
    if (!this.allow()) return;
    void this.send(error, context).catch(() => undefined);
  }

  private allow(): boolean {
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= this.maxPerMinute) return false;
    this.sentInWindow += 1;
    return true;
  }

  private async send(
    error: unknown,
    context: ErrorReportContext,
  ): Promise<void> {
    const dsn = this.dsn;
    if (!dsn) return;
    const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetchFn !== "function") return;

    const ctx = getRequestContext();
    const err = error instanceof Error ? error : new Error(String(error));
    const eventId = randomEventId();
    const timestamp = new Date().toISOString();

    const event = {
      event_id: eventId,
      timestamp,
      platform: "node",
      level: "error",
      logger: "nova-backend",
      environment: this.environment,
      release: this.release,
      server_name: this.serverName,
      transaction: context.where,
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            stacktrace: { frames: parseStackFrames(err.stack) },
          },
        ],
      },
      tags: {
        statusCode: context.statusCode,
        method: context.method,
        appRole: this.serverName,
      },
      user: context.userId ? { id: context.userId } : undefined,
      contexts: {
        trace: ctx?.traceId
          ? { trace_id: ctx.traceId, span_id: ctx.requestId }
          : undefined,
      },
      extra: { requestId: ctx?.requestId, ...(context.extra ?? {}) },
    };

    // صيغة Envelope: سطر ترويسة + سطر نوع العنصر + سطر الحمولة (JSON لكل سطر).
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: timestamp }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetchFn(sentryEnvelopeUrl(dsn), {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `Sentry sentry_version=7, sentry_client=nova-inhouse/1.0, sentry_key=${dsn.publicKey}`,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Sentry رفض الحدث: ${res.status}`);
      }
    } catch (e) {
      this.logger.warn(
        `تعذر إرسال خطأ إلى Sentry: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/** معرّف حدث سداسي عشري من 32 خانة (مطلوب من Sentry). */
function randomEventId(): string {
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** يحوّل نص الـ stack إلى إطارات Sentry (الأقدم أولًا كما تتوقع الواجهة). */
export function parseStackFrames(
  stack?: string,
): Array<{ filename: string; function?: string; lineno?: number }> {
  if (!stack) return [];
  const frames = stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 30)
    .map((line) => {
      const match = /^at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/.exec(line);
      if (match) {
        return {
          function: match[1],
          filename: match[2],
          lineno: Number(match[3]),
        };
      }
      const bare = /^at\s+(.*?):(\d+):(\d+)$/.exec(line);
      if (bare) {
        return { filename: bare[1], lineno: Number(bare[2]) };
      }
      return { filename: line.replace(/^at\s+/, "") };
    });
  return frames.reverse();
}
