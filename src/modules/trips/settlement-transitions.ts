// حالات تسوية الرحلة المالية مُعرّفة محليًا لتبقى آلة الحالة والاختبارات
// مستقلة عن توليد Prisma Client. القيم مطابقة لـ enum SettlementStatus في schema.prisma.
export type SettlementStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "POSTED"
  | "FAILED"
  | "RETRYING";

/**
 * الانتقالات المسموح بها لحالة التسوية المالية للرحلة (آلة حالات).
 * - NOT_REQUIRED: الرحلة لم تكتمل بعد (لا تسوية مطلوبة).
 * - PENDING: اكتملت وتنتظر الترحيل إلى دفتر الأستاذ.
 * - RETRYING: تجري إعادة محاولة بعد فشل.
 * - FAILED: فشل الترحيل (قابل لإعادة المحاولة).
 * - POSTED: حالة نهائية — التسوية مُرحّلة على دفتر الأستاذ.
 */
export const SETTLEMENT_TRANSITIONS: Record<
  SettlementStatus,
  SettlementStatus[]
> = {
  NOT_REQUIRED: ["PENDING"],
  PENDING: ["RETRYING", "POSTED", "FAILED"],
  RETRYING: ["POSTED", "FAILED"],
  FAILED: ["RETRYING", "POSTED"],
  POSTED: [],
};

/** هل يُسمح بالانتقال من حالة التسوية from إلى to؟ */
export function canSettlementTransition(
  from: SettlementStatus,
  to: SettlementStatus,
): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

/** هل حالة التسوية نهائية (لا خروج منها)؟ */
export function isTerminalSettlement(status: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[status].length === 0;
}
