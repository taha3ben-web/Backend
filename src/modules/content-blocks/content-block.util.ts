/**
 * منطق نقي لكتل المحتوى (Content Blocks): تطبيع المعرّف (slug)
 * واللغة، وتحديد نافذة العرض (startsAt/endsAt)، ومطابقة الجمهور.
 * بلا اعتماد على قاعدة بيانات أو NestJS — قابل لاختبارات الوحدة. لا تسعير/خصم.
 */

import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type Locale,
} from "../../common/api/api-error.util";

export type ContentAudienceValue = "ALL" | "PASSENGER" | "DRIVER";

/** يوحّد اللغة إلى إحدى اللغات المدعومة (وإلا الافتراضية). */
export function normalizeLocale(locale?: string | null): Locale {
  const v = (locale ?? "").trim().toLowerCase();
  return (SUPPORTED_LOCALES as string[]).includes(v)
    ? (v as Locale)
    : DEFAULT_LOCALE;
}

/** يحوّل النص إلى معرّف آمن (حروف صغيرة/أرقام/نقطة/شرطة). */
export function normalizeSlug(slug: string): string {
  if (typeof slug !== "string") return "";
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function validTime(d?: Date | null): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** هل اللحظة الحالية داخل نافذة العرض [startsAt, endsAt]؟ (الحدود الفارغة مفتوحة). */
export function isWithinWindow(
  now: Date,
  startsAt?: Date | null,
  endsAt?: Date | null,
): boolean {
  const t = now.getTime();
  if (validTime(startsAt) && t < startsAt.getTime()) return false;
  if (validTime(endsAt) && t > endsAt.getTime()) return false;
  return true;
}

/** نافذة العرض صالحة ما لم يكن البدء بعد النهاية. */
export function isValidWindow(
  startsAt?: Date | null,
  endsAt?: Date | null,
): boolean {
  if (validTime(startsAt) && validTime(endsAt)) {
    return startsAt.getTime() <= endsAt.getTime();
  }
  return true;
}

export interface ContentWindow {
  isActive: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

/** المحتوى معروض للعملاء إذا كان مفعّلًا وداخل النافذة. */
export function isContentLive(block: ContentWindow, now: Date): boolean {
  return (
    block.isActive === true &&
    isWithinWindow(now, block.startsAt ?? null, block.endsAt ?? null)
  );
}

/** مطابقة الجمهور: ALL تطابق الجميع، وإلا تطابق النوع المطلوب أو ALL. */
export function matchesAudience(
  blockAudience: ContentAudienceValue,
  requested?: ContentAudienceValue | null,
): boolean {
  if (!requested || requested === "ALL") return true;
  return blockAudience === "ALL" || blockAudience === requested;
}

/** يوحّد قيمة الجمهور الواردة (أو undefined إذا غير صالحة). */
export function normalizeAudience(
  value?: string | null,
): ContentAudienceValue | undefined {
  const v = (value ?? "").trim().toUpperCase();
  return v === "ALL" || v === "PASSENGER" || v === "DRIVER"
    ? (v as ContentAudienceValue)
    : undefined;
}
