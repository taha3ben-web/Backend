/**
 * دوال نقيّة لإدارة أقسام جدول التتبّع — قابلة للاختبار دون قاعدة بيانات.
 *
 * أسماء الأقسام تُبنى من تواريخ فقط (لا مدخلات مستخدم)، ويتم التحقق منها
 * بتعبير نمطي صارم قبل أي تنفيذ SQL ديناميكي — حماية من الحقن.
 */

export const TRACKING_PARTITION_PREFIX = "TripTracking_";
export const TRACKING_PARTITION_PATTERN = /^TripTracking_(\d{4})(\d{2})$/;

/** عدد الأشهر التي تُحفظ افتراضيًا قبل الحذف. */
export const DEFAULT_RETENTION_MONTHS = 3;
/** عدد الأشهر المستقبلية التي يُنشأ لها قسم مسبقًا. */
export const PARTITION_LOOKAHEAD_MONTHS = 2;

/** يبني اسم قسم الشهر: TripTracking_202607 */
export function trackingPartitionName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${TRACKING_PARTITION_PREFIX}${year}${month}`;
}

/** يتحقق من أن الاسم قسم تتبّع شهري صالح (وليس جدولًا آخر). */
export function isTrackingPartition(name: string): boolean {
  return TRACKING_PARTITION_PATTERN.test(name);
}

/** يستخرج بداية الشهر من اسم القسم، أو null إن لم يطابق النمط. */
export function partitionMonthStart(name: string): Date | null {
  const match = TRACKING_PARTITION_PATTERN.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

/** يزيح تاريخًا بعدد أشهر (موجب أو سالب) مع تثبيته على بداية الشهر. */
export function shiftMonth(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

/**
 * يحدد الأقسام الواجب حذفها: كل قسم يسبق حدّ الاحتفاظ.
 * القسم الافتراضي لا يُحذف أبدًا لأنّه شبكة الأمان.
 */
export function partitionsToDrop(
  existing: string[],
  now: Date,
  retentionMonths: number,
): string[] {
  const cutoff = shiftMonth(now, -Math.max(1, retentionMonths));
  return existing
    .filter(isTrackingPartition)
    .filter((name) => {
      const start = partitionMonthStart(name);
      return start !== null && start.getTime() < cutoff.getTime();
    })
    .sort();
}

/** يقرأ عدد أشهر الاحتفاظ من البيئة مع حدود عاقلة. */
export function retentionMonthsFromEnv(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_MONTHS;
  return Math.min(60, Math.max(1, Math.trunc(n)));
}
