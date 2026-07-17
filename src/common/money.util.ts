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

/**
 * العملة الافتراضية للنظام. تُقرأ من متغيّر البيئة `DEFAULT_CURRENCY`
 * (ISO-4217، 3 أحرف) وتتراجع إلى "DZD" فقط كقيمة احتياطية.
 *
 * الهدف: إزالة أي عملة مثبّتة بالكود (hardcoded) وجعل النظام متعدّد
 * العملات فعليًا — أي مسار مالي جديد يجب أن يستمد العملة من الحساب/
 * البلد، وعند غياب ذلك يستعمل هذا الافتراض المركزي.
 */
export const DEFAULT_CURRENCY: string = (
  process.env.DEFAULT_CURRENCY?.trim() || "DZD"
).toUpperCase();

/** التحقق من صحة رمز عملة ISO-4217 (3 أحرف كبيرة). */
export function isValidCurrency(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency);
}

/**
 * مقياس الوحدات الصغرى (minor units) القياسي للنظام: 100 (سنت لكل وحدة
 * عملة رئيسية بمنزلتين عشريتين). هذا هو مصدر الحقيقة الوحيد لأي تحويل بين
 * التمثيل الرئيسي العشري (major / Decimal) والأعداد الصحيحة الصغرى (minor)
 * المستخدمة في دفتر الأستاذ والدفعات، لتوحيد تمثيل المال عبر النظام.
 */
export const MONEY_SCALE = 100;

/**
 * تحويل مبلغ من التمثيل الرئيسي (major، عشري) إلى وحدات صغرى صحيحة
 * (minor) بالمقياس القياسي، مع تقريب لأقرب وحدة صغرى لتفادي أخطاء
 * الفاصلة العائمة. مثال: toMinorUnits(12.34) => 1234.
 */
export function toMinorUnits(value: number, scale: number = MONEY_SCALE): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * scale);
}

/**
 * تحويل مبلغ من الوحدات الصغرى الصحيحة (minor) إلى التمثيل الرئيسي
 * (major، عشري) بالمقياس القياسي. مثال: fromMinorUnits(1234) => 12.34.
 */
export function fromMinorUnits(minor: number, scale: number = MONEY_SCALE): number {
  if (!Number.isFinite(minor) || scale <= 0) return 0;
  const decimals = Math.max(0, Math.round(Math.log10(scale)));
  return roundMoney(minor / scale, decimals);
}

/**
 * التأكّد من توازن قيود دفتر الأستاذ (مجموع المدين = مجموع الدائن، وكلاهما > 0)
 * بوحدة الحد الأدنى (minor units) لتفادي أخطاء الفاصلة العائمة.
 * دالة نقية قابلة لاختبار الوحدة ومشتركة بين محرك القيد واختباراته.
 */
export function isBalanced(
  lines: Array<{ direction: "DEBIT" | "CREDIT"; amount: number }>,
  scale: number = MONEY_SCALE,
): boolean {
  if (lines.length < 2) return false;
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.amount)) return false;
    const minor = toMinorUnits(line.amount, scale);
    if (minor <= 0) return false;
    if (line.direction === "DEBIT") debit += minor;
    else credit += minor;
  }
  return debit > 0 && debit === credit;
}
