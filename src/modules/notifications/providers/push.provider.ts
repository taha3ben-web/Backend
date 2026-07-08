import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * مزوّد الإشعارات الفورية (Push) عبر Firebase Cloud Messaging.
 * إن لم يُضبط FCM_SERVER_KEY يُسجّل تحذيرًا ويتخطى (بدون كسر النظام).
 */
@Injectable()
export class PushProvider {
  private readonly logger = new Logger(PushProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get serverKey(): string {
    return this.config.get<string>("notifications.fcmServerKey") ?? "";
  }

  get isConfigured(): boolean {
    return this.serverKey.length > 0;
  }

  /** يرسل على دفعات (FCM يقبل حتى 1000 جهاز في الطلب) */
  async send(msg: PushMessage): Promise<number> {
    if (msg.tokens.length === 0) return 0;
    if (!this.isConfigured) {
      this.logger.warn(
        `FCM غير مضبوط — تخطي إرسال Push إلى ${msg.tokens.length} جهاز`,
      );
      return 0;
    }

    let sent = 0;
    const chunks = this.chunk(msg.tokens, 1000);
    for (const registrationIds of chunks) {
      try {
        const res = await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: {
            Authorization: `key=${this.serverKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            registration_ids: registrationIds,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
          }),
        });
        if (res.ok) {
          sent += registrationIds.length;
        } else {
          this.logger.error(`FCM خطأ ${res.status}: ${await res.text()}`);
        }
      } catch (err) {
        this.logger.error(`FCM فشل الإرسال: ${err}`);
      }
    }
    return sent;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}
