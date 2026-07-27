import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailProvider } from "./providers/email.provider";
import type { EmailTemplateId } from "./providers/email-templates";
import {
  isSendableEmail,
  recipientLocale,
  recipientName,
} from "./transactional-email.util";

/**
 * البريد المعاملاتي: الجسر بين أحداث النطاق (فاتورة صدرت، تحويل صُرف)
 * وقوالب البريد متعددة اللغات.
 *
 * قاعدتان غير قابلتين للتفاوض:
 *
 * 1. **لا ترمي أبدًا.** إرسال بريد إجراء ثانوي؛ فشله لا يجوز أن يُرجِع
 *    تسوية مالية نجحت أو يفشل طلب API نجح.
 * 2. **لغة المستخدم تُقرأ من سجله** (`User.locale`) وليس من لغة الطلب؛
 *    الحدث قد يأتي من cron أو من موظّف لغته مختلفة.
 */
@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger("TransactionalEmail");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProvider,
  ) {}

  /**
   * يرسل قالبًا إلى مستخدم واحد. يُرجِع سبب التخطي بدل الرمي حتى
   * يمكن تسجيله ومراقبته دون إزعاج مسار العمل الأساسي.
   *
   * `name` يُملأ تلقائيًا من سجل المستخدم إن لم يُمرّر صراحة.
   */
  async sendToUser(input: {
    userId: string;
    template: EmailTemplateId;
    vars?: Record<string, string>;
  }): Promise<{ sent: boolean; reason?: string }> {
    if (!this.email.isConfigured) {
      return { sent: false, reason: "EMAIL_NOT_CONFIGURED" };
    }

    let user: {
      email: string | null;
      name: string | null;
      locale: string | null;
    } | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true, locale: true },
      });
    } catch (error) {
      this.logger.warn(
        `تعذر قراءة مستخدم البريد: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { sent: false, reason: "USER_LOOKUP_FAILED" };
    }

    if (!user) return { sent: false, reason: "USER_NOT_FOUND" };
    if (!isSendableEmail(user.email)) {
      return { sent: false, reason: "NO_EMAIL" };
    }

    const locale = recipientLocale(user.locale);
    const vars = {
      name: recipientName(user.name, locale),
      ...(input.vars ?? {}),
    };

    try {
      const result = await this.email.sendTemplate({
        emails: [user.email as string],
        template: input.template,
        locale,
        vars,
      });
      if (result.sent < 1) {
        return { sent: false, reason: "PROVIDER_REJECTED" };
      }
      // لا نسجّل العنوان — المعرّف والقالب يكفيان للتشخيص.
      this.logger.log(`بريد ${input.template} (${locale}) إلى ${input.userId}`);
      return { sent: true };
    } catch (error) {
      this.logger.warn(
        `تعذر إرسال بريد ${input.template} إلى ${input.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { sent: false, reason: "SEND_FAILED" };
    }
  }

  /** نسخة لا تنتظر ولا ترمي — للاستدعاء من داخل مسارات حرجة. */
  fireAndForget(input: {
    userId: string;
    template: EmailTemplateId;
    vars?: Record<string, string>;
  }): void {
    void this.sendToUser(input).catch(() => undefined);
  }
}
