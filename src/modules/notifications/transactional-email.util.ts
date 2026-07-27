import {
  DEFAULT_EMAIL_LOCALE,
  resolveEmailLocale,
  type EmailLocale,
} from "./providers/email-templates";

/**
 * دوال نقيّة لرسائل البريد المعاملاتية (فاتورة، إيصال، تحويل، مفقودات).
 * لا قاعدة بيانات ولا شبكة هنا — لذلك تُختبر كلها مباشرة.
 */

/** تحقق بسيط من شكل البريد: يمنع المحاولة على قيمة فارغة أو مشوّهة. */
export function isSendableEmail(value?: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed);
}

/** الاسم المعروض في الرسالة، مع بديل محترم بلغة المستخدم إن كان الاسم ناقصًا. */
export function recipientName(
  name: string | null | undefined,
  locale: EmailLocale,
): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  if (locale === "fr") return "Cher client";
  if (locale === "en") return "Dear customer";
  return "\u0639\u0645\u064a\u0644\u0646\u0627 \u0627\u0644\u0643\u0631\u064a\u0645";
}

/** يقرأ لغة المستخدم من السجل مع الرجوع إلى العربية. */
export function recipientLocale(locale?: string | null): EmailLocale {
  return resolveEmailLocale(locale ?? DEFAULT_EMAIL_LOCALE);
}

/**
 * تنسيق المبلغ برقمين عشريين دائمًا.
 *
 * لماذا لا نستخدم Intl هنا: الأرقام الهندية وفواصل الألوف تختلف بين
 * عملاء البريد وقد تصل مكسورة؛ والمبلغ المالي يجب أن يُقرأ حرفيًا بلا لبس.
 */
export function formatEmailAmount(amount: unknown): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2);
}

/** تسميات حالات بلاغ المفقودات باللغات الثلاث. */
const LOST_ITEM_STATUS_LABELS: Record<string, Record<EmailLocale, string>> = {
  REPORTED: {
    ar: "\u062a\u0645 \u0627\u0633\u062a\u0644\u0627\u0645 \u0627\u0644\u0628\u0644\u0627\u063a",
    fr: "Signalement re\u00e7u",
    en: "Report received",
  },
  DRIVER_NOTIFIED: {
    ar: "\u062a\u0645 \u0625\u0628\u0644\u0627\u063a \u0627\u0644\u0633\u0627\u0626\u0642",
    fr: "Chauffeur pr\u00e9venu",
    en: "Driver notified",
  },
  FOUND: {
    ar: "\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u064a\u0647",
    fr: "Objet retrouv\u00e9",
    en: "Item found",
  },
  RETURNED: {
    ar: "\u062a\u0645 \u062a\u0633\u0644\u064a\u0645\u0647 \u0625\u0644\u064a\u0643",
    fr: "Objet restitu\u00e9",
    en: "Item returned",
  },
  NOT_FOUND: {
    ar: "\u0644\u0645 \u064a\u064f\u0639\u062b\u0631 \u0639\u0644\u064a\u0647",
    fr: "Objet introuvable",
    en: "Item not found",
  },
  CLOSED: {
    ar: "\u0623\u064f\u063a\u0644\u0642 \u0627\u0644\u0628\u0644\u0627\u063a",
    fr: "Dossier clos",
    en: "Case closed",
  },
};

/** يحوّل حالة البلاغ إلى نص مقروء؛ الحالة غير المعروفة تُعاد كما هي بدل أن ترمي. */
export function lostItemStatusLabel(
  status: string,
  locale: EmailLocale,
): string {
  return LOST_ITEM_STATUS_LABELS[status]?.[locale] ?? status;
}
