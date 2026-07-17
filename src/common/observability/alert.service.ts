import { Injectable, Logger } from "@nestjs/common";
import {
  Alert,
  AlertInput,
  buildAlert,
  detectSinkKind,
  formatAlertPayload,
  shouldSend,
} from "./alert.util";
import { getRequestContext } from "./request-context";

/**
 * خدمة توصيل التنبيهات إلى وجهة خارجية (Slack أو webhook عام) بأفضل جهد:
 *  - تقرأ رابط الوجهة من `ALERT_WEBHOOK_URL` (إن غاب تُسجّل التنبيه محليًا فقط).
 *  - تخنق التكرار (dedup + throttle) حتّى لا تغرق القنوات بنفس التنبيه.
 *  - لا تُوقف أي عملية إن فشل الإرسال (best-effort).
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger("Alerts");
  private readonly webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim() || null;
  private readonly throttleMs = Number(
    process.env.ALERT_THROTTLE_MS ?? 5 * 60_000,
  );
  private readonly sink = detectSinkKind(this.webhookUrl);
  private readonly lastSentAt = new Map<string, number>();

  /** يُطلق تنبيهًا (غير حاجب — fire-and-forget آمن). */
  async emit(input: AlertInput): Promise<void> {
    const alert = buildAlert(input);

    // دائمًا نسجّل التنبيه محليًا (مربوط بـ requestId/traceId).
    const ctx = getRequestContext();
    const logPayload = {
      alert: alert.kind,
      severity: alert.severity,
      title: alert.title,
      dedupKey: alert.dedupKey,
      traceId: ctx?.traceId,
      context: alert.context,
    };
    if (alert.severity === "CRITICAL") {
      this.logger.error(JSON.stringify(logPayload));
    } else if (alert.severity === "WARNING") {
      this.logger.warn(JSON.stringify(logPayload));
    } else {
      this.logger.log(JSON.stringify(logPayload));
    }

    if (this.sink === "none" || !this.webhookUrl) return;

    const now = Date.now();
    if (
      !shouldSend(this.lastSentAt.get(alert.dedupKey), now, this.throttleMs)
    ) {
      return;
    }
    this.lastSentAt.set(alert.dedupKey, now);

    await this.deliver(alert);
  }

  private async deliver(alert: Alert): Promise<void> {
    // توصيل بأفضل جهد: أي فشل لا يُوقف عمل النظام.
    try {
      const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
      if (typeof fetchFn !== "function") {
        this.logger.warn("fetch غير متوفر — تعذّر توصيل التنبيه خارجيًا");
        return;
      }
      const payload = formatAlertPayload(alert, this.sink);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetchFn(this.webhookUrl as string, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(`توصيل التنبيه أرجع حالة ${res.status}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      this.logger.warn(
        `فشل توصيل التنبيه: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
