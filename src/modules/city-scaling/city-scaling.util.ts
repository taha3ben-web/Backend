/**
 * منطق نقي لضوابط التوسّع عبر المدن: حالة الإطلاق، سقوف السعة،
 * تفعيل فئات الركوب، وسقف مضاعف الذروة (surge).
 */

export type CityLaunchStatus = "PLANNED" | "PILOT" | "LIVE" | "PAUSED";

export interface CityScalingControl {
  launchStatus: CityLaunchStatus;
  maxActiveDrivers: number | null;
  maxDailyTrips: number | null;
  enabledRideClasses: string[];
  surgeCap: number | null;
}

export interface CapacitySnapshot {
  activeDrivers: number;
  dailyTrips: number;
}

export interface AcceptDecision {
  accept: boolean;
  reason?: string;
}

/** هل تقبل المدينة طلبات ركوب جديدة الآن؟ */
export function canAcceptTrip(
  control: CityScalingControl,
  snapshot: CapacitySnapshot,
  rideClass: string,
): AcceptDecision {
  if (control.launchStatus === "PAUSED") {
    return { accept: false, reason: "CITY_PAUSED" };
  }
  if (control.launchStatus === "PLANNED") {
    return { accept: false, reason: "NOT_LAUNCHED" };
  }
  if (!isRideClassEnabled(control, rideClass)) {
    return { accept: false, reason: "RIDE_CLASS_DISABLED" };
  }
  if (
    control.maxDailyTrips != null &&
    snapshot.dailyTrips >= control.maxDailyTrips
  ) {
    return { accept: false, reason: "DAILY_TRIP_CAP" };
  }
  if (
    control.maxActiveDrivers != null &&
    snapshot.activeDrivers >= control.maxActiveDrivers
  ) {
    return { accept: false, reason: "DRIVER_CAP" };
  }
  return { accept: true };
}

/** فئة الركوب مفعّلة إذا كانت القائمة فارغة (الكل مفعّل) أو تحتويها. */
export function isRideClassEnabled(
  control: CityScalingControl,
  rideClass: string,
): boolean {
  if (!control.enabledRideClasses || control.enabledRideClasses.length === 0) {
    return true;
  }
  return control.enabledRideClasses.includes(rideClass);
}

/** سقف مضاعف الذروة الفعّال (يقيّد المضاعف المطلوب). */
export function effectiveSurgeMultiplier(
  control: CityScalingControl,
  requested: number,
): number {
  const floored = Math.max(1, requested);
  if (control.surgeCap == null) return floored;
  return Math.min(floored, control.surgeCap);
}

/** نسبة استغلال السعة (0..1) للسائقين النشطين. */
export function driverUtilization(
  control: CityScalingControl,
  snapshot: CapacitySnapshot,
): number {
  if (!control.maxActiveDrivers || control.maxActiveDrivers <= 0) return 0;
  return (
    Math.round(
      Math.min(1, snapshot.activeDrivers / control.maxActiveDrivers) * 1000,
    ) / 1000
  );
}

const TRANSITIONS: Record<CityLaunchStatus, CityLaunchStatus[]> = {
  PLANNED: ["PILOT", "LIVE"],
  PILOT: ["LIVE", "PAUSED"],
  LIVE: ["PAUSED"],
  PAUSED: ["LIVE", "PILOT"],
};

export function canChangeLaunchStatus(
  from: CityLaunchStatus,
  to: CityLaunchStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}
