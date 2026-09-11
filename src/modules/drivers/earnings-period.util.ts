/**
 * حدود فترات التقارير (اليوم/الأسبوع/الشهر/السنة) بتوقيت المنصّة — دالة نقية.
 *
 * ===== لماذا لا نستعمل توقيت الخادم =====
 * خوادم الإنتاج تعمل بـUTC. حساب «بداية اليوم» بـ`new Date(y, m, d)` يعني
 * أن يوم السائق في الجزائر (UTC+1) ينتهي الساعة 01:00 صباحًا، فتظهر رحلات
 * ما بين منتصف الليل والواحدة في أرباح «اليوم السابق». نفس المبدأ المستعمل
 * في محرك التسعير لنوافذ الذروة (`localDayMinutes`)، ونفس متغيّر البيئة
 * `APP_TIMEZONE`.
 *
 * الأسبوع يبدأ **الاثنين** حفاظًا على السلوك المنشور سابقًا للتطبيق.
 *
 * ملاحظة التوقيت الصيفي: الإزاحة تُقاس عند اللحظة الحالية وتُطبّق على حدود
 * الفترة. المنصّة تعمل في نطاق بلا توقيت صيفي (Africa/Algiers)، وفي نطاق
 * بتوقيت صيفي قد تنزاح الحدود ساعة واحدة في يوم التحويل فقط — وهو فرق
 * عرضي لا محاسبي (الأرباح نفسها لا تتغير، فقط تصنيفها بين فترتين).
 */

export const DEFAULT_APP_TIMEZONE = "Africa/Algiers";

export interface PeriodBoundaries {
  dayStart: Date;
  weekStart: Date;
  monthStart: Date;
  yearStart: Date;
  timezone: string;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = الأحد … 6 = السبت */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** أجزاء التاريخ/الوقت المحلية في نطاق زمني معيّن. */
export function localParts(now: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // بعض البيئات تُرجع 24 عند منتصف الليل
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: WEEKDAY_INDEX[map.weekday] ?? now.getUTCDay(),
  };
}

/**
 * يحوّل «لحظة محلية» (سنة/شهر/يوم 00:00 في النطاق) إلى لحظة UTC حقيقية،
 * باستخدام إزاحة النطاق المقيسة عند `reference`.
 */
function localMidnightToInstant(
  reference: Date,
  timezone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const p = localParts(reference, timezone);
  const localNowAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  // إزاحة النطاق = (الوقت المحلي مُقروءًا كـUTC) − (اللحظة الفعلية).
  const offsetMs = localNowAsUtc - Math.floor(reference.getTime() / 1000) * 1000;
  return new Date(Date.UTC(year, month - 1, day) - offsetMs);
}

/** حدود اليوم/الأسبوع/الشهر/السنة بتوقيت المنصّة. */
export function periodBoundaries(
  now: Date = new Date(),
  timezone: string = process.env.APP_TIMEZONE?.trim() || DEFAULT_APP_TIMEZONE,
): PeriodBoundaries {
  let parts: LocalParts;
  let tz = timezone;
  try {
    parts = localParts(now, tz);
  } catch {
    // نطاق غير معروف في بيئة التشغيل — نتراجع إلى UTC بدل الفشل.
    tz = "UTC";
    parts = localParts(now, tz);
  }

  const dayStart = localMidnightToInstant(
    now,
    tz,
    parts.year,
    parts.month,
    parts.day,
  );
  // الاثنين = بداية الأسبوع: (0=الأحد) → الأحد يرجع 6 أيام للخلف.
  const daysSinceMonday = (parts.weekday + 6) % 7;
  const weekStart = new Date(
    dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000,
  );
  const monthStart = localMidnightToInstant(now, tz, parts.year, parts.month, 1);
  const yearStart = localMidnightToInstant(now, tz, parts.year, 1, 1);

  return { dayStart, weekStart, monthStart, yearStart, timezone: tz };
}
