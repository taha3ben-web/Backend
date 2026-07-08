/**
 * دوال مالية نقية (بلا اعتماد على مكتبات خارجية) — قابلة لاختبارات الوحدة.
 *
 * الغرض: توحيد تقريب المبالغ المالية إلى منزلتين عشريتين مع تصحيح
 * أخطاء تمثيل الفاصلة العائمة (floating-point) التي تجعل تعبيرًا مثل
 * `Math.round(292.675 * 100) / 100` يُنتج 292.67 بدلًا من 292.68.
 *
 * تُستخدم في التسعير، التسوية، الكوبونات، والأرباح لضمان اتساق كل
 * الحسابات المالية عبر النظام (Single Source of Truth للتقريب).
 */

/**
 * تقريب مبلغ مالي إلى منزلتين عشريتين (نصف لأعلى away-from-zero) مع
 * تصحيح خطأ الفاصلة العائمة عبر إزاحة صغيرة جدًا (1e-6 من السنت) لا
 * تؤثر على أي قيمة نقدية حقيقية لكنها تعالج حالات الحدّ مثل *.xx5.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const cents = value * 100;
  const nudge = cents >= 0 ? 1e-6 : -1e-6;
  return Math.round(cents + nudge) / 100;
}

/**
 * تقريب مبلغ إلى عدد اختياري من المنازل العشرية (الافتراضي 2) بنفس
 * منطق تصحيح الفاصلة العائمة.
 */
export function roundMoney(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const nudge = scaled >= 0 ? 1e-6 : -1e-6;
  return Math.round(scaled + nudge) / factor;
}
