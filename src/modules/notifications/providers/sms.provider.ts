import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface SmsMessage {
  phones: string[];
  body: string;
}

/**
 * مزوّد الرسائل النصية (SMS) عبر بوابة HTTP عامة.
 * قابل للتوصيل مع Twilio أو أي مزوّد محلي عبر متغيرات البيئة.
 */
@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  private cfg() {
    return {
      apiUrl: this.config.get<string>("notifications.sms.apiUrl") ?? "",
      apiKey: this.config.get<string>("notifications.sms.apiKey") ?? "",
      sender: this.config.get<string>("notifications.sms.sender") ?? "NOVA",
    };
  }

  get isConfigured(): boolean {
    return this.cfg().apiUrl.length > 0;
  }

  async send(msg: SmsMessage): Promise<number> {
    if (msg.phones.length === 0) return 0;
    const { apiUrl, apiKey, sender } = this.cfg();
    if (!apiUrl) {
      this.logger.warn(
        `بوابة SMS غير مضبوطة — تخطي إرسال إلى ${msg.phones.length} رقم`,
      );
      return 0;
    }

    let sent = 0;
    for (const to of msg.phones) {
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to, from: sender, text: msg.body }),
        });
        if (res.ok) sent += 1;
        else this.logger.error(`SMS خطأ ${res.status}`);
      } catch (err) {
        this.logger.error(`SMS فشل الإرسال: ${err}`);
      }
    }
    return sent;
  }
}
