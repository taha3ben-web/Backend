// حالات الرحلة مُعرّفة محليًا حتى تبقى آلة الحالة والاختبارات مستقلة
// عن توليد Prisma Client. القيم مطابقة تمامًا لـ enum TripStatus في schema.prisma.
export type TripStatus =
  | "SEARCHING"
  | "ACCEPTED"
  | "ARRIVING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

/**
 * الانتقالات المسموح بها لحالة الرحلة (آلة حالات).
 * COMPLETED و CANCELLED حالتان نهائيتان لا خروج منهما.
 */
export const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  SEARCHING: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["ARRIVING", "CANCELLED"],
  ARRIVING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** هل يُسمح بالانتقال من الحالة from إلى الحالة to؟ */
export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
