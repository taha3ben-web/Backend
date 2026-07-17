/**
 * منطق نقي لحوافز السائقين: تقييم التقدّم نحو الهدف وحساب المكافأة.
 */

export type IncentiveKind =
  "TRIP_COUNT" | "EARNINGS_THRESHOLD" | "ACCEPTANCE_RATE" | "STREAK_DAYS";

export interface IncentiveCriteria {
  /** الهدف المطلوب بلوغه (رحلات، وحدات صغرى، نسبة %، أيام). */
  target: number;
  /** قيمة المكافأة بالوحدات الصغرى. */
  rewardMinor: number;
}

export interface DriverStats {
  tripCount?: number;
  earningsMinor?: number;
  acceptanceRate?: number; // 0..1
  streakDays?: number;
}

export interface IncentiveProgress {
  progress: number;
  target: number;
  ratio: number; // 0..1
  achieved: boolean;
  rewardMinor: number;
}

function metricFor(kind: IncentiveKind, stats: DriverStats): number {
  switch (kind) {
    case "TRIP_COUNT":
      return stats.tripCount ?? 0;
    case "EARNINGS_THRESHOLD":
      return stats.earningsMinor ?? 0;
    case "ACCEPTANCE_RATE":
      return stats.acceptanceRate ?? 0;
    case "STREAK_DAYS":
      return stats.streakDays ?? 0;
    default:
      return 0;
  }
}

/** يقيّم تقدّم السائق نحو حافز معيّن. لا تُمنح المكافأة إلّا عند البلوغ. */
export function evaluateProgress(
  kind: IncentiveKind,
  criteria: IncentiveCriteria,
  stats: DriverStats,
): IncentiveProgress {
  const target = criteria.target;
  const progress = metricFor(kind, stats);
  const ratio =
    target > 0
      ? Math.min(1, Math.max(0, progress / target))
      : progress > 0
        ? 1
        : 0;
  const achieved = target > 0 ? progress >= target : progress > 0;
  return {
    progress,
    target,
    ratio: Math.round(ratio * 1000) / 1000,
    achieved,
    rewardMinor: achieved ? criteria.rewardMinor : 0,
  };
}

/** هل الحافز فعّال ضمن النافذة الزمنية؟ */
export function isIncentiveActive(
  startMs: number,
  endMs: number,
  nowMs: number,
): boolean {
  return nowMs >= startMs && nowMs <= endMs;
}

/** إجمالي المكافآت المستحقّة من قائمة نتائج. */
export function totalReward(items: IncentiveProgress[]): number {
  return items.reduce((sum, i) => sum + (i.achieved ? i.rewardMinor : 0), 0);
}
