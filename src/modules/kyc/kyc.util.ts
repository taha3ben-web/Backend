/**
 * منطق نقيّ للتحقق من هوية المستخدم (KYC) — قابل للاختبار بمعزل عن NestJS/Prisma.
 * لا يعتمد على أي مكتبة خارجية.
 */

export type IdentityStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface IdentityRecordLike {
  status: IdentityStatus;
  expiresAt?: Date | string | null;
}

/** هل انتهت صلاحية تاريخ معيّن مقارنة بالآن؟ (null => لا تنتهي). */
export function isExpired(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (expiresAt == null) return false;
  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() <= now.getTime();
}

/**
 * الحالة الفعلية للسجل: طلب موافق عليه انتهت صلاحيته يُعتبر EXPIRED.
 * لا يعدّل قاعدة البيانات — مجرّد اشتقاق للعرض/القرار.
 */
export function effectiveStatus(
  record: IdentityRecordLike | null | undefined,
  now: Date = new Date(),
): IdentityStatus | "NONE" {
  if (!record) return "NONE";
  if (record.status === "APPROVED" && isExpired(record.expiresAt, now)) {
    return "EXPIRED";
  }
  return record.status;
}

/**
 * هل يُسمح للمستخدم بتقديم طلب تحقق جديد؟
 * يُمنع إن كان لديه طلب قيد المراجعة (PENDING) أو تحقق ساري المفعول (APPROVED غير منتهٍ).
 * يُسمح إن لا يوجد سجل، أو الحالة الفعلية REJECTED أو EXPIRED.
 */
export function canSubmit(
  latest: IdentityRecordLike | null | undefined,
  now: Date = new Date(),
): boolean {
  const status = effectiveStatus(latest, now);
  return status === "NONE" || status === "REJECTED" || status === "EXPIRED";
}

/** يوحّد رقم الوثيقة (إزالة الفراغات + حروف كبيرة). يُعيد null للفارغ. */
export function normalizeDocNumber(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * يحسب تاريخ انتهاء صلاحية الموافقة من عدد أيام اختياري.
 * days غير صالح/غير موجب => null (بلا انتهاء).
 */
export function resolveExpiry(
  now: Date,
  days: number | null | undefined,
): Date | null {
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + Math.trunc(days));
  return d;
}
