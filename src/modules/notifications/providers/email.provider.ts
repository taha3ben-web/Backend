import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface EmailMessage {
  emails: string[];
  subject: string;
  body: string;
}

/**
 * مزوّد البريد عبر API HTTP عام (مثل Resend / SendGrid).
 * إن لم يُضبط EMAIL_API_URL يُتخطى بأمان.
 */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  private cfg() {
    return {
      apiUrl: this.config.get<string>("notifications.email.apiUrl") ?? "",
      apiKey: this.config.get<string>("notifications.email.apiKey") ?? "",
      from:
        this.config.get<string>("notifications.email.from") ??
        "flaminGO <no-reply@novaride.app>",
    };
  }

  get isConfigured(): boolean {
    return this.cfg().apiUrl.length > 0;
  }

  async send(msg: EmailMessage): Promise<number> {
    if (msg.emails.length === 0) return 0;
    const { apiUrl, apiKey, from } = this.cfg();
    if (!apiUrl) {
      this.logger.warn(
        `مزوّد البريد غير مضبوط — تخطي إرسال إلى ${msg.emails.length} بريد`,
      );
      return 0;
    }

    let sent = 0;
    for (const to of msg.emails) {
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to,
            subject: msg.subject,
            html: msg.body,
          }),
        });
        if (res.ok) sent += 1;
        else this.logger.error(`Email خطأ ${res.status}`);
      } catch (err) {
        this.logger.error(`Email فشل الإرسال: ${err}`);
      }
    }
    return sent;
  }
}
