/**
 * طبقة نقية لتوصيل التنبيهات (Alerting) إلى وجهات خارجية (Slack/Webhook)،
 * بلا اعتماد على أي حزمة خارجية — قابلة لاختبارات الوحدة.
 *
 * المسؤوليات: تصنيف الخطورة، مفتاح إزالة التكرار (dedup)، خنق التكرار ضمن نافذة
 * زمنية، وتنسيق الحمولة لـ Slack أو webhook عام.
 */

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AlertInput {
  /** معرّف ثابت لنوع التنبيه (مثل "reconciliation.mismatch"). */
  kind: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** حقول سياق إضافية (accountId، tripId، diff…). */
  context?: Record<string, unknown>;
}

export interface Alert extends AlertInput {
  dedupKey: string;
  timestamp: string;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  INFO: "\u2139\ufe0f",
  WARNING: "\u26a0\ufe0f",
  CRITICAL: "\ud83d\udea8",
};

/**
 * يبني مفتاح إزالة التكرار: نوع التنبيه + معرّف المورد (إن وُجد)،
 * حتّى لا يُرسل نفس التنبيه مرارًا خلال نافذة الخنق.
 */
export function buildDedupKey(
  kind: string,
  context?: Record<string, unknown>,
): string {
  const ref =
    context?.accountId ?? context?.tripId ?? context?.id ?? context?.ref ?? "";
  return ref ? `${kind}:${String(ref)}` : kind;
}

/** يقرّر هل يُرسل التنبيه أم يُخنَق (حسب آخر وقت إرسال لنفس المفتاح). */
export function shouldSend(
  lastSentAtMs: number | undefined,
  nowMs: number,
  throttleMs: number,
): boolean {
  if (lastSentAtMs === undefined) return true;
  return nowMs - lastSentAtMs >= throttleMs;
}

/** يرفع مستوى الخطورة إلى أسوأ قيمة في قائمة. */
export function worstSeverity(severities: AlertSeverity[]): AlertSeverity {
  if (severities.includes("CRITICAL")) return "CRITICAL";
  if (severities.includes("WARNING")) return "WARNING";
  return "INFO";
}

/** يبني كائن تنبيه كامل بمفتاح إزالة تكرار وطابع زمني. */
export function buildAlert(input: AlertInput, now?: Date): Alert {
  return {
    ...input,
    dedupKey: buildDedupKey(input.kind, input.context),
    timestamp: (now ?? new Date()).toISOString(),
  };
}

/** نوع الوجهة الخارجية المستنتج من رابط الـ webhook. */
export type AlertSinkKind = "slack" | "webhook" | "none";

export function detectSinkKind(webhookUrl?: string | null): AlertSinkKind {
  if (!webhookUrl) return "none";
  return webhookUrl.includes("hooks.slack.com") ? "slack" : "webhook";
}

/** ينسّق حمولة جاهزة لإرسالها إلى الوجهة المناسبة. */
export function formatAlertPayload(
  alert: Alert,
  sink: AlertSinkKind,
): Record<string, unknown> {
  if (sink === "slack") {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const contextLines = alert.context
      ? Object.entries(alert.context)
          .map(([k, v]) => `\u2022 *${k}*: ${String(v)}`)
          .join("\n")
      : "";
    const text =
      `${emoji} *[${alert.severity}] ${alert.title}*\n${alert.message}` +
      (contextLines ? `\n${contextLines}` : "");
    return { text };
  }
  // webhook عام: نُرسل التنبيه كاملاً كـ JSON.
  return {
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    context: alert.context ?? {},
    dedupKey: alert.dedupKey,
    timestamp: alert.timestamp,
  };
}
