/**
 * ترقيم الفواتير — دوال نقيّة قابلة للاختبار دون قاعدة بيانات.
 *
 * الفاتورة وثيقة محاسبية: الترقيم يجب أن يكون متسلسلًا وبلا فجوات
 * داخل كل فترة، ولا يجوز استخدام UUID أو طابع زمني عشوائي.
 */

export const INVOICE_PREFIX = "FG";
export const INVOICE_SEQUENCE_PAD = 6;

/** يُرجع مفتاح الفترة الشهرية بصيغة YYYYMM. */
export function invoicePeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

/** يبني رقم الفاتورة: FG-202607-000123 */
export function buildInvoiceNumber(period: string, sequence: number): string {
  const padded = String(Math.max(1, Math.trunc(sequence))).padStart(
    INVOICE_SEQUENCE_PAD,
    "0",
  );
  return `${INVOICE_PREFIX}-${period}-${padded}`;
}

/** تقريب مبلغ إلى منزلتين عشريتين بأمان. */
export function money(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** ينسّق مبلغًا مع عملته للعرض داخل الـ PDF. */
export function formatAmount(value: unknown, currency: string): string {
  return `${money(value).toFixed(2)} ${currency}`;
}
