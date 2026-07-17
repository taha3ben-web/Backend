/**
 * أدوات نقيّة للتحقق من المركبات (بلا اعتماديات) — قابلة للاختبار وحدها.
 * لا تعتمد على Prisma أو Nest حتى تبقى قابلة للاستيراد في اختبارات tsx.
 */

export type VehicleVerification = "PENDING" | "APPROVED" | "REJECTED";

export interface VehicleIdentityLike {
  make?: string | null;
  model?: string | null;
  plate?: string | null;
  year?: number | null;
}

/** توحيد لوحة التسجيل: إزالة الفراغات ورفعها لأحرف كبيرة. */
export function normalizePlate(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

/** هل المركبة موثّقة (معتمدة)؟ */
export function isVehicleVerified(
  status: VehicleVerification | null | undefined,
): boolean {
  return status === "APPROVED";
}

/** هل يمكن للمركبة خدمة الرحلات؟ (موثّقة + مفعّلة) */
export function canServeRides(v: {
  verificationStatus?: VehicleVerification | null;
  isActive?: boolean | null;
}): boolean {
  return v.isActive === true && v.verificationStatus === "APPROVED";
}

/** هل تغيّرت هوية المركبة (الصانع/الطراز/اللوحة/السنة)؟ */
export function identityChanged(
  current: VehicleIdentityLike,
  next: VehicleIdentityLike,
): boolean {
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
  if (norm(current.make) !== norm(next.make)) return true;
  if (norm(current.model) !== norm(next.model)) return true;
  if (normalizePlate(current.plate) !== normalizePlate(next.plate)) return true;
  const cy = current.year ?? null;
  const ny = next.year ?? null;
  if (cy !== ny) return true;
  return false;
}

/** هل قرار المراجعة هدف صالح؟ */
export function isReviewTarget(
  target: string,
): target is "APPROVED" | "REJECTED" {
  return target === "APPROVED" || target === "REJECTED";
}
