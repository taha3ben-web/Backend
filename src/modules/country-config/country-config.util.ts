/**
 * طبقة نقية لإعدادات البلد (Country Config) — بلا اعتماد على قاعدة البيانات
 * أو أي مكتبة خارجية، قابلة لاختبارات الوحدة.
 *
 * الهدف (P1): جعل النظام متعدّد البلدان فعليًا بدل أي افتراض مثبّت بالكود.
 * كل بلد يعرّف: العملة، الضريبة، تنسيق/تطبيع رقم الهاتف (E.164)، اللغة
 * (locale)، المنطقة الزمنية، وطرق الدفع المتاحة. تُستهلك هذه الطبقة من
 * الخدمة (`CountryConfigService`) التي تدمج التخصيصات المخزّنة في قاعدة
 * البيانات فوق هذه الافتراضات المدمجة.
 */

import { round2 } from "../../common/money.util";

/** طريقة دفع مدعومة على مستوى البلد. */
export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "WALLET"
  | "BANK_TRANSFER"
  | "MOBILE_MONEY";

/** كيفية تطبيق الضريبة على الأجرة. */
export type TaxMode = "INCLUSIVE" | "EXCLUSIVE";

/**
 * إعداد بلد كامل. `code` هو رمز ISO-3166-1 alpha-2 (حرفان كبيران).
 * `dialCode` رمز الاتصال الدولي بلا علامة `+` (مثل "213" للجزائر).
 */
export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
  /** الطول الوطني المتوقّع للرقم بعد إزالة الصفر البادئ ورمز الاتصال. */
  nationalNumberLength: number;
  locale: string;
  timezone: string;
  taxRatePct: number;
  taxMode: TaxMode;
  paymentMethods: PaymentMethod[];
}

/**
 * سجلّ الافتراضات المدمجة. يغطّي أسواقًا مبدئية؛ يمكن للخدمة إضافة/تعديل
 * بلدان عبر قاعدة البيانات دون لمس هذا الملف.
 */
export const DEFAULT_COUNTRY_CONFIGS: Readonly<Record<string, CountryConfig>> = {
  DZ: {
    code: "DZ",
    name: "Algeria",
    currency: "DZD",
    dialCode: "213",
    nationalNumberLength: 9,
    locale: "ar-DZ",
    timezone: "Africa/Algiers",
    taxRatePct: 19,
    taxMode: "INCLUSIVE",
    paymentMethods: ["CASH", "CARD", "WALLET"],
  },
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    currency: "AED",
    dialCode: "971",
    nationalNumberLength: 9,
    locale: "ar-AE",
    timezone: "Asia/Dubai",
    taxRatePct: 5,
    taxMode: "EXCLUSIVE",
    paymentMethods: ["CASH", "CARD", "WALLET", "BANK_TRANSFER"],
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    currency: "SAR",
    dialCode: "966",
    nationalNumberLength: 9,
    locale: "ar-SA",
    timezone: "Asia/Riyadh",
    taxRatePct: 15,
    taxMode: "EXCLUSIVE",
    paymentMethods: ["CASH", "CARD", "WALLET", "BANK_TRANSFER"],
  },
  FR: {
    code: "FR",
    name: "France",
    currency: "EUR",
    dialCode: "33",
    nationalNumberLength: 9,
    locale: "fr-FR",
    timezone: "Europe/Paris",
    taxRatePct: 20,
    taxMode: "INCLUSIVE",
    paymentMethods: ["CARD", "WALLET", "BANK_TRANSFER"],
  },
};

/** تطبيع رمز البلد إلى حرفين كبيرين. */
export function normalizeCountryCode(code: string): string {
  return (code || "").trim().toUpperCase();
}

/** التحقق من صحة رمز البلد (ISO-3166-1 alpha-2). */
export function isValidCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(normalizeCountryCode(code));
}

/**
 * جلب إعداد بلد من سجلّ معطى (أو الافتراضات) مع تراجع اختياري إلى بلد
 * افتراضي. تُعيد `null` إن لم يوجد ولا تراجع.
 */
export function resolveCountryConfig(
  code: string,
  registry: Record<string, CountryConfig> = DEFAULT_COUNTRY_CONFIGS as Record<
    string,
    CountryConfig
  >,
  fallbackCode?: string,
): CountryConfig | null {
  const key = normalizeCountryCode(code);
  if (registry[key]) return registry[key];
  if (fallbackCode) {
    const fb = normalizeCountryCode(fallbackCode);
    if (registry[fb]) return registry[fb];
  }
  return null;
}

/**
 * تطبيع رقم هاتف إلى صيغة E.164 (`+` + رمز الاتصال + الرقم الوطني)
 * اعتمادًا على إعداد البلد. يتعامل مع:
 * - المسافات/الشرطات/الأقواس (تُزال).
 * - بادئة `00` الدولية أو `+` (تُحترم كما هي بعد التنظيف).
 * - الصفر الوطني البادئ (يُزال قبل إلحاق رمز الاتصال).
 *
 * تُعيد `null` إذا تعذّر إنتاج رقم صالح بالطول المتوقّع.
 */
export function normalizePhoneE164(
  raw: string,
  country: Pick<CountryConfig, "dialCode" | "nationalNumberLength">,
): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.startsWith("00")) {
    s = s.slice(2);
  }
  if (!/^\d+$/.test(s)) return null;

  const { dialCode, nationalNumberLength } = country;

  // إن كان الرقم يبدأ برمز الاتصال بالفعل، خُذ ما بعده كرقم وطني.
  let national: string;
  if (s.startsWith(dialCode) && s.length > dialCode.length) {
    national = s.slice(dialCode.length);
  } else {
    national = s;
  }
  // أزل الصفر الوطني البادئ (شائع في الترقيم المحلي).
  national = national.replace(/^0+/, "");

  if (national.length !== nationalNumberLength) return null;
  return `+${dialCode}${national}`;
}

/**
 * حساب مكوّن الضريبة على مبلغ الأجرة حسب وضع الضريبة.
 * - EXCLUSIVE: الضريبة تُضاف فوق المبلغ. tax = amount * rate.
 * - INCLUSIVE: المبلغ يتضمّن الضريبة أصلًا. tax = amount * rate / (1 + rate).
 * تُعيد المبلغ الصافي (net) والضريبة والإجمالي (gross) مقرّبة لمنزلتين.
 */
export function computeTax(
  amount: number,
  taxRatePct: number,
  taxMode: TaxMode,
): { net: number; tax: number; gross: number } {
  const rate = Math.max(0, taxRatePct) / 100;
  if (rate === 0) {
    return { net: round2(amount), tax: 0, gross: round2(amount) };
  }
  if (taxMode === "EXCLUSIVE") {
    const tax = round2(amount * rate);
    return { net: round2(amount), tax, gross: round2(amount + tax) };
  }
  // INCLUSIVE
  const tax = round2((amount * rate) / (1 + rate));
  return { net: round2(amount - tax), tax, gross: round2(amount) };
}
