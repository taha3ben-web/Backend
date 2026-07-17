import type { TripStatus } from "@prisma/client";
export type { TripStatus };

/**
 * الانتقالات المسموح بها لحالة الرحلة (آلة حالات).
 * COMPLETED و CANCELLED حالتان نهائيتان لا خروج منهما.
 */
export const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  SCHEDULED: ["SEARCHING", "CANCELLED"],
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
