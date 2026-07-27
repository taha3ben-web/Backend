import { BadRequestException } from "@nestjs/common";

/**
 * قوالب البريد الموحّدة.
 *
 * لماذا ملف نقي بلا حقن: التوليد دالة خالصة (locale + متغيرات → موضوع + HTML + نص)،
 * فيمكن اختباره بلا قاعدة بيانات وبلا شبكة، ولا يتكرر تصميم الرسالة في كل خدمة.
 */

export type EmailLocale = "ar" | "fr" | "en";

export const SUPPORTED_EMAIL_LOCALES: EmailLocale[] = ["ar", "fr", "en"];
export const DEFAULT_EMAIL_LOCALE: EmailLocale = "ar";

export type EmailTemplateId =
  | "generic_notice"
  | "welcome"
  | "trip_receipt"
  | "invoice_ready"
  | "payout_settled"
  | "lost_item_update";

export interface EmailBrand {
  name: string;
  primaryColor: string;
  backgroundColor: string;
  supportEmail: string;
  appUrl?: string;
}

export const DEFAULT_EMAIL_BRAND: EmailBrand = {
  name: "flaminGO",
  primaryColor: "#D4AF37",
  backgroundColor: "#111111",
  supportEmail: "support@novaride.app",
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface TemplateCopy {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; urlVar: string };
}

/** المتغيرات الإلزامية لكل قالب — النقص يرمي خطأً بدل إرسال رسالة بها فراغات. */
export const EMAIL_TEMPLATE_VARS: Record<EmailTemplateId, string[]> = {
  generic_notice: ["title", "body"],
  welcome: ["name"],
  trip_receipt: ["name", "tripId", "amount", "currency", "date"],
  invoice_ready: ["name", "invoiceNumber", "amount", "currency"],
  payout_settled: ["name", "amount", "currency", "reference"],
  lost_item_update: ["name", "itemTitle", "status"],
};

const COPY: Record<EmailTemplateId, Record<EmailLocale, TemplateCopy>> = {
  generic_notice: {
    ar: {
      subject: "{{title}}",
      heading: "{{title}}",
      paragraphs: ["{{body}}"],
    },
    fr: {
      subject: "{{title}}",
      heading: "{{title}}",
      paragraphs: ["{{body}}"],
    },
    en: {
      subject: "{{title}}",
      heading: "{{title}}",
      paragraphs: ["{{body}}"],
    },
  },
  welcome: {
    ar: {
      subject: "مرحبًا بك في flaminGO",
      heading: "أهلًا {{name}}",
      paragraphs: [
        "تم إنشاء حسابك بنجاح. يمكنك الآن طلب رحلتك الأولى في أي وقت.",
        "إن احتجت أي مساعدة، فريق الدعم متاح لك.",
      ],
    },
    fr: {
      subject: "Bienvenue chez flaminGO",
      heading: "Bonjour {{name}}",
      paragraphs: [
        "Votre compte a été créé. Vous pouvez commander votre première course dès maintenant.",
        "Notre équipe support reste à votre disposition.",
      ],
    },
    en: {
      subject: "Welcome to flaminGO",
      heading: "Hi {{name}}",
      paragraphs: [
        "Your account is ready. You can request your first ride right away.",
        "Our support team is here if you need anything.",
      ],
    },
  },
  trip_receipt: {
    ar: {
      subject: "إيصال رحلتك — {{amount}} {{currency}}",
      heading: "شكرًا لاستخدامك flaminGO",
      paragraphs: [
        "مرحبًا {{name}}، انتهت رحلتك بتاريخ {{date}}.",
        "المبلغ الإجمالي: {{amount}} {{currency}}",
        "رقم الرحلة: {{tripId}}",
      ],
    },
    fr: {
      subject: "Votre reçu — {{amount}} {{currency}}",
      heading: "Merci d'avoir voyagé avec flaminGO",
      paragraphs: [
        "Bonjour {{name}}, votre course du {{date}} est terminée.",
        "Montant total : {{amount}} {{currency}}",
        "Numéro de course : {{tripId}}",
      ],
    },
    en: {
      subject: "Your receipt — {{amount}} {{currency}}",
      heading: "Thanks for riding with flaminGO",
      paragraphs: [
        "Hi {{name}}, your trip on {{date}} is complete.",
        "Total charged: {{amount}} {{currency}}",
        "Trip ID: {{tripId}}",
      ],
    },
  },
  invoice_ready: {
    ar: {
      subject: "فاتورتك {{invoiceNumber}} جاهزة",
      heading: "فاتورتك جاهزة",
      paragraphs: [
        "مرحبًا {{name}}، أصدرنا الفاتورة {{invoiceNumber}} بمبلغ {{amount}} {{currency}}.",
      ],
      cta: { label: "تحميل الفاتورة", urlVar: "invoiceUrl" },
    },
    fr: {
      subject: "Votre facture {{invoiceNumber}} est prête",
      heading: "Votre facture est prête",
      paragraphs: [
        "Bonjour {{name}}, la facture {{invoiceNumber}} d'un montant de {{amount}} {{currency}} est disponible.",
      ],
      cta: { label: "Télécharger la facture", urlVar: "invoiceUrl" },
    },
    en: {
      subject: "Your invoice {{invoiceNumber}} is ready",
      heading: "Your invoice is ready",
      paragraphs: [
        "Hi {{name}}, invoice {{invoiceNumber}} for {{amount}} {{currency}} is available.",
      ],
      cta: { label: "Download invoice", urlVar: "invoiceUrl" },
    },
  },
  payout_settled: {
    ar: {
      subject: "تمّ تحويل أرباحك — {{amount}} {{currency}}",
      heading: "تمّ التحويل",
      paragraphs: [
        "مرحبًا {{name}}، حوّلنا {{amount}} {{currency}} إلى حسابك البنكي.",
        "مرجع الدفعة: {{reference}}",
      ],
    },
    fr: {
      subject: "Votre virement — {{amount}} {{currency}}",
      heading: "Virement effectué",
      paragraphs: [
        "Bonjour {{name}}, nous avons viré {{amount}} {{currency}} sur votre compte bancaire.",
        "Référence : {{reference}}",
      ],
    },
    en: {
      subject: "Your payout — {{amount}} {{currency}}",
      heading: "Payout sent",
      paragraphs: [
        "Hi {{name}}, we transferred {{amount}} {{currency}} to your bank account.",
        "Reference: {{reference}}",
      ],
    },
  },
  lost_item_update: {
    ar: {
      subject: "تحديث بخصوص مفقوداتك",
      heading: "تحديث الطلب",
      paragraphs: [
        "مرحبًا {{name}}، حالة بلاغك عن «{{itemTitle}}» أصبحت: {{status}}.",
      ],
    },
    fr: {
      subject: "Mise à jour de votre objet perdu",
      heading: "Mise à jour",
      paragraphs: [
        "Bonjour {{name}}, le statut de votre déclaration « {{itemTitle}} » est : {{status}}.",
      ],
    },
    en: {
      subject: "Update on your lost item",
      heading: "Status update",
      paragraphs: [
        "Hi {{name}}, your report for \u201c{{itemTitle}}\u201d is now: {{status}}.",
      ],
    },
  },
};

export function resolveEmailLocale(value?: string | null): EmailLocale {
  const normalized = value?.trim().toLowerCase().slice(0, 2);
  return SUPPORTED_EMAIL_LOCALES.includes(normalized as EmailLocale)
    ? (normalized as EmailLocale)
    : DEFAULT_EMAIL_LOCALE;
}

export function isRtlLocale(locale: EmailLocale): boolean {
  return locale === "ar";
}

/** يمنع حقن HTML من بيانات المستخدم (اسم، عنوان مفقود، سبب...). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fill(
  template: string,
  vars: Record<string, string>,
  mode: "html" | "text",
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key] ?? "";
    return mode === "html" ? escapeHtml(value) : value;
  });
}

export function readEmailBrand(
  env: NodeJS.ProcessEnv = process.env,
): EmailBrand {
  return {
    name: env.EMAIL_BRAND_NAME?.trim() || DEFAULT_EMAIL_BRAND.name,
    primaryColor:
      env.EMAIL_BRAND_COLOR?.trim() || DEFAULT_EMAIL_BRAND.primaryColor,
    backgroundColor:
      env.EMAIL_BRAND_BACKGROUND?.trim() || DEFAULT_EMAIL_BRAND.backgroundColor,
    supportEmail:
      env.EMAIL_SUPPORT_ADDRESS?.trim() || DEFAULT_EMAIL_BRAND.supportEmail,
    appUrl: env.EMAIL_APP_URL?.trim() || undefined,
  };
}

/**
 * التخطيط الموحّد: جدول واحد بعرض ثابت (أعلى توافقًا مع عملاء البريد من flex/grid)،
 * وأنماط سطرية فقط لأن Gmail يحذف <style> في كثير من الحالات، مع dir صحيح للعربية.
 */
export function renderEmailLayout(args: {
  locale: EmailLocale;
  heading: string;
  bodyHtml: string;
  brand: EmailBrand;
}): string {
  const { locale, heading, bodyHtml, brand } = args;
  const dir = isRtlLocale(locale) ? "rtl" : "ltr";
  const align = isRtlLocale(locale) ? "right" : "left";
  const footer =
    locale === "ar"
      ? `هذه رسالة آلية من ${escapeHtml(brand.name)}. للمساعدة: ${escapeHtml(brand.supportEmail)}`
      : locale === "fr"
        ? `Message automatique de ${escapeHtml(brand.name)}. Aide : ${escapeHtml(brand.supportEmail)}`
        : `Automated message from ${escapeHtml(brand.name)}. Help: ${escapeHtml(brand.supportEmail)}`;

  return [
    `<!DOCTYPE html>`,
    `<html lang="${locale}" dir="${dir}">`,
    `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(heading)}</title></head>`,
    `<body style="margin:0;padding:24px 0;background:#f5f5f5;font-family:Segoe UI,Tahoma,Arial,sans-serif;" dir="${dir}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;">`,
    `<tr><td style="background:${brand.backgroundColor};padding:22px 28px;text-align:${align};">`,
    `<span style="color:${brand.primaryColor};font-size:22px;font-weight:700;letter-spacing:0.5px;">${escapeHtml(brand.name)}</span>`,
    `</td></tr>`,
    `<tr><td style="padding:28px;text-align:${align};color:#111111;">`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#111111;">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `</td></tr>`,
    `<tr><td style="padding:18px 28px;background:#f5f5f5;text-align:${align};color:#666666;font-size:12px;line-height:1.6;">${footer}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

/**
 * يولّد الرسالة النهائية. يرمي `EMAIL_TEMPLATE_VAR_MISSING_*` عند نقص متغير
 * إلزامي — أفضل من إرسال بريد فيه فراغ للعميل.
 */
export function renderEmailTemplate(args: {
  template: EmailTemplateId;
  locale?: string | null;
  vars: Record<string, string>;
  brand?: EmailBrand;
}): RenderedEmail {
  const copyForTemplate = COPY[args.template];
  if (!copyForTemplate) {
    throw new BadRequestException(`EMAIL_TEMPLATE_UNKNOWN_${args.template}`);
  }
  for (const required of EMAIL_TEMPLATE_VARS[args.template]) {
    if (!args.vars[required]?.trim()) {
      throw new BadRequestException(
        `EMAIL_TEMPLATE_VAR_MISSING_${required.toUpperCase()}`,
      );
    }
  }

  const locale = resolveEmailLocale(args.locale);
  const brand = args.brand ?? readEmailBrand();
  const copy = copyForTemplate[locale];
  const align = isRtlLocale(locale) ? "right" : "left";

  const paragraphsHtml = copy.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#333333;text-align:${align};">${fill(p, args.vars, "html")}</p>`,
    )
    .join("");

  const ctaUrl = copy.cta ? args.vars[copy.cta.urlVar]?.trim() : undefined;
  const ctaHtml =
    copy.cta && ctaUrl
      ? `<p style="margin:22px 0 0;text-align:${align};"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:${brand.primaryColor};color:#111111;font-weight:700;font-size:15px;text-decoration:none;">${escapeHtml(copy.cta.label)}</a></p>`
      : "";

  const heading = fill(copy.heading, args.vars, "text");
  const subject = fill(copy.subject, args.vars, "text");
  const text = [
    heading,
    ...copy.paragraphs.map((p) => fill(p, args.vars, "text")),
  ]
    .concat(ctaUrl ? [ctaUrl] : [])
    .join("\n\n");

  return {
    subject,
    html: renderEmailLayout({
      locale,
      heading,
      bodyHtml: paragraphsHtml + ctaHtml,
      brand,
    }),
    text,
  };
}
