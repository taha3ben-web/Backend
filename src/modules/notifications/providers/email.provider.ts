import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EmailBrand,
  EmailTemplateId,
  RenderedEmail,
  readEmailBrand,
  renderEmailLayout,
  renderEmailTemplate,
  resolveEmailLocale,
} from "./email-templates";

export interface EmailMessage {
  emails: string[];
  subject: string;
  body: string;
  /** نسخة نصية بديلة (تحسّن من تقييم مكافحة السبام). */
  text?: string;
  /** لغة المستلم؛ تحدّد اتجاه القالب (rtl/ltr). */
  locale?: string | null;
  /** إن كان المحتوى HTML كاملًا مسبقًا لا يُلفّ في التخطيط مرة أخرى. */
  prerendered?: boolean;
}

export type EmailProviderName = "resend" | "sendgrid" | "generic";

export const RESEND_API_URL = "https://api.resend.com/emails";
export const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";
export const EMAIL_DEFAULT_TIMEOUT_MS = 10_000;

export function resolveEmailProviderName(value?: string): EmailProviderName {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "resend") return "resend";
  if (normalized === "sendgrid") return "sendgrid";
  return "generic";
}

/** يفصل "flaminGO <no-reply@x>" إلى اسم وبريد (SendGrid يطلبهما منفصلين). */
export function parseEmailAddress(value: string): {
  email: string;
  name?: string;
} {
  const match = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (match) {
    const name = match[1]?.replace(/^"|"$/g, "").trim();
    return { email: match[2].trim(), name: name || undefined };
  }
  return { email: value.trim() };
}

export interface EmailHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * يبني طلب HTTP المناسب لكل مزوّد. دالة خالصة لتُختبر بلا شبكة.
 */
export function buildEmailRequest(args: {
  provider: EmailProviderName;
  apiUrl?: string;
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): EmailHttpRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    "Content-Type": "application/json",
  };

  if (args.provider === "resend") {
    return {
      url: args.apiUrl?.trim() || RESEND_API_URL,
      headers,
      body: {
        from: args.from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        ...(args.text ? { text: args.text } : {}),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      },
    };
  }

  if (args.provider === "sendgrid") {
    const from = parseEmailAddress(args.from);
    const content: Array<{ type: string; value: string }> = [];
    if (args.text) content.push({ type: "text/plain", value: args.text });
    content.push({ type: "text/html", value: args.html });
    return {
      url: args.apiUrl?.trim() || SENDGRID_API_URL,
      headers,
      body: {
        personalizations: [{ to: [{ email: args.to }] }],
        from: from.name
          ? { email: from.email, name: from.name }
          : { email: from.email },
        subject: args.subject,
        content,
        ...(args.replyTo
          ? { reply_to: { email: parseEmailAddress(args.replyTo).email } }
          : {}),
      },
    };
  }

  return {
    url: args.apiUrl?.trim() ?? "",
    headers,
    body: {
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    },
  };
}

/**
 * مزوّد البريد الموحّد: Resend / SendGrid / أي API عام.
 *
 * قرارات:
 * - رسالة لكل مستلم على حدة (لا يرى أحد بريد أحد).
 * - مهلة زمنية صريحة؛ مزوّد بريد بطيء لا يجوز أن يجمّد طلب مستخدم.
 * - كل المحتوى يمرّ عبر التخطيط الموحّد مع dir صحيح للعربية.
 */
@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);

  constructor(private readonly config: ConfigService) {}

  private cfg() {
    const provider = resolveEmailProviderName(process.env.EMAIL_PROVIDER);
    const apiUrl = this.config.get<string>("notifications.email.apiUrl") ?? "";
    const timeoutRaw = Number(process.env.EMAIL_TIMEOUT_MS);
    return {
      provider,
      apiUrl,
      apiKey: this.config.get<string>("notifications.email.apiKey") ?? "",
      from:
        this.config.get<string>("notifications.email.from") ??
        "flaminGO <no-reply@novaride.app>",
      replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
      timeoutMs:
        Number.isFinite(timeoutRaw) && timeoutRaw > 0
          ? timeoutRaw
          : EMAIL_DEFAULT_TIMEOUT_MS,
      brand: readEmailBrand(),
    };
  }

  /** المزوّدون المعروفون يحتاجون مفتاحًا فقط؛ العام يحتاج عنوانًا أيضًا. */
  get isConfigured(): boolean {
    const { provider, apiUrl, apiKey } = this.cfg();
    if (provider === "generic") return apiUrl.length > 0;
    return apiKey.length > 0;
  }

  get providerName(): EmailProviderName {
    return this.cfg().provider;
  }

  get brand(): EmailBrand {
    return this.cfg().brand;
  }

  /** إرسال رسالة حرة — تُلفّ تلقائيًا في التخطيط الموحّد إن لم تكن مُولّدة مسبقًا. */
  async send(msg: EmailMessage): Promise<number> {
    if (msg.emails.length === 0) return 0;
    const cfg = this.cfg();
    if (!this.isConfigured) {
      this.logger.warn(
        `مزوّد البريد غير مضبوط — تخطي إرسال إلى ${msg.emails.length} بريد`,
      );
      return 0;
    }

    const locale = resolveEmailLocale(msg.locale);
    const html = msg.prerendered
      ? msg.body
      : renderEmailLayout({
          locale,
          heading: msg.subject,
          bodyHtml: `<div style="font-size:15px;line-height:1.7;color:#333333;">${msg.body}</div>`,
          brand: cfg.brand,
        });

    let sent = 0;
    for (const to of msg.emails) {
      const ok = await this.deliver({
        to,
        subject: msg.subject,
        html,
        text: msg.text,
      });
      if (ok) sent += 1;
    }
    return sent;
  }

  /** إرسال قالب معرّف بلغة المستلم. */
  async sendTemplate(args: {
    emails: string[];
    template: EmailTemplateId;
    locale?: string | null;
    vars: Record<string, string>;
  }): Promise<number> {
    if (args.emails.length === 0) return 0;
    const rendered: RenderedEmail = renderEmailTemplate({
      template: args.template,
      locale: args.locale,
      vars: args.vars,
      brand: this.cfg().brand,
    });
    return this.send({
      emails: args.emails,
      subject: rendered.subject,
      body: rendered.html,
      text: rendered.text,
      locale: args.locale,
      prerendered: true,
    });
  }

  private async deliver(args: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    const cfg = this.cfg();
    const request = buildEmailRequest({
      provider: cfg.provider,
      apiUrl: cfg.apiUrl,
      apiKey: cfg.apiKey,
      from: cfg.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: cfg.replyTo,
    });
    if (!request.url) {
      this.logger.error("عنوان مزوّد البريد غير مضبوط");
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (res.ok) return true;
      // لا نسجل البريد الكامل في اللوغ (بيانات شخصية).
      this.logger.error(`Email ${cfg.provider} خطأ ${res.status}`);
      return false;
    } catch (err) {
      const reason = err instanceof Error ? err.name : "unknown";
      this.logger.error(`Email ${cfg.provider} فشل الإرسال: ${reason}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
