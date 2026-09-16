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

/** الحالات التي تكون فيها الرحلة قائمة والسائق مُسنَدًا. */
export const LIVE_TRIP_STATUSES: TripStatus[] = [
  "ACCEPTED",
  "ARRIVING",
  "IN_PROGRESS",
];

/** حالات مشاركة الرحلة: البحث إضافة إلى الحالات القائمة. */
export const SHAREABLE_TRIP_STATUSES: TripStatus[] = [
  "SEARCHING",
  ...LIVE_TRIP_STATUSES,
];

export function isLiveTripStatus(status: string): boolean {
  return (LIVE_TRIP_STATUSES as readonly string[]).includes(status);
}

/**
 * حالات الرحلة الفورية الجارية — المصدر الوحيد للحقيقة لقاعدة التفرّد.
 * SCHEDULED مستثناة عمدًا حتى لا يحجب الحجز المستقبلي رحلة فورية الآن.
 * يجب أن تبقى القائمة مطابقة للفهرس الجزئي
 * `Trip_one_active_per_passenger_idx` في مايغريشن
 * `20260910060000_trip_active_passenger_uniqueness`.
 */
export const ACTIVE_IMMEDIATE_TRIP_STATUSES: TripStatus[] = [
  "SEARCHING",
  ...LIVE_TRIP_STATUSES,
];

export function isActiveImmediateTripStatus(status: string): boolean {
  return (ACTIVE_IMMEDIATE_TRIP_STATUSES as readonly string[]).includes(status);
}
