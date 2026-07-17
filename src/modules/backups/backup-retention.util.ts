/**
 * منطق نقي للنسخ الاحتياطية والتعافي من الكوارث (DR):
 * — سياسة الاستبقاء (GFS: أحدث/يومي/أسبوعي/شهري)
 * — حساب حالة DR مقابل هدف نقطة الاسترداد (RPO)
 * بلا اعتماد على قاعدة بيانات أو NestJS — قابل لاختبارات الوحدة. لا تسعير/خصم.
 */

export interface RetentionCandidate {
  id: string;
  timestamp: Date;
}

export interface RetentionPolicy {
  keepLatest: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
}

export interface RetentionResult {
  retainIds: string[];
  pruneIds: string[];
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  keepLatest: 3,
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 12,
};

function validTime(d?: Date | null): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function dayKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function weekKeyOf(d: Date): string {
  // دلو أسبوعي حتمي مبني على UTC (عدد الأسابيع منذ الحقبة).
  return `w${Math.floor(d.getTime() / (7 * 86_400_000))}`;
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * يحدّد أي النسخ تُستبقى وأيها تُقلّم وفق سياسة GFS.
 * النسخة قد تُستبقى لأكثر من طبقة (الاتحاد).
 */
export function selectRetained(
  candidates: RetentionCandidate[],
  policy: RetentionPolicy,
): RetentionResult {
  const sorted = (candidates ?? [])
    .filter((c) => c && typeof c.id === "string" && validTime(c.timestamp))
    .slice()
    .sort((a, b) => {
      const diff = b.timestamp.getTime() - a.timestamp.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  const keepLatest = clampNonNeg(policy.keepLatest);
  const keepDaily = clampNonNeg(policy.keepDaily);
  const keepWeekly = clampNonNeg(policy.keepWeekly);
  const keepMonthly = clampNonNeg(policy.keepMonthly);

  const retain = new Set<string>();
  const dayBuckets = new Set<string>();
  const weekBuckets = new Set<string>();
  const monthBuckets = new Set<string>();

  sorted.forEach((c, index) => {
    if (index < keepLatest) retain.add(c.id);

    const dk = dayKeyOf(c.timestamp);
    if (!dayBuckets.has(dk) && dayBuckets.size < keepDaily) {
      dayBuckets.add(dk);
      retain.add(c.id);
    }

    const wk = weekKeyOf(c.timestamp);
    if (!weekBuckets.has(wk) && weekBuckets.size < keepWeekly) {
      weekBuckets.add(wk);
      retain.add(c.id);
    }

    const mk = monthKeyOf(c.timestamp);
    if (!monthBuckets.has(mk) && monthBuckets.size < keepMonthly) {
      monthBuckets.add(mk);
      retain.add(c.id);
    }
  });

  const retainIds = sorted.filter((c) => retain.has(c.id)).map((c) => c.id);
  const pruneIds = sorted.filter((c) => !retain.has(c.id)).map((c) => c.id);
  return { retainIds, pruneIds };
}

export interface DrStatus {
  healthy: boolean;
  ageMinutes: number | null;
  rpoMinutes: number;
  breached: boolean;
  lastSuccessfulAt: string | null;
}

/** يحسب حالة التعافي: هل آخر نسخة ناجحة داخل هدف RPO؟ */
export function computeDrStatus(
  now: Date,
  lastSuccessfulAt: Date | null | undefined,
  rpoMinutes: number,
): DrStatus {
  const rpo = clampNonNeg(rpoMinutes);
  if (!validTime(lastSuccessfulAt)) {
    return {
      healthy: false,
      ageMinutes: null,
      rpoMinutes: rpo,
      breached: true,
      lastSuccessfulAt: null,
    };
  }
  const ageMinutes = Math.max(
    0,
    Math.floor((now.getTime() - lastSuccessfulAt.getTime()) / 60_000),
  );
  const breached = ageMinutes > rpo;
  return {
    healthy: !breached,
    ageMinutes,
    rpoMinutes: rpo,
    breached,
    lastSuccessfulAt: lastSuccessfulAt.toISOString(),
  };
}

/** موعد النسخة التالية المتوقعة بناءً على فترة الجدولة. */
export function nextBackupDue(
  lastAt: Date | null | undefined,
  intervalMinutes: number,
): Date | null {
  if (!validTime(lastAt)) return null;
  const interval = Math.max(1, clampNonNeg(intervalMinutes) || 1);
  return new Date(lastAt.getTime() + interval * 60_000);
}

/** تنسيق الحجم بالميجابايت إلى نص مقروء. */
export function formatSizeMb(mb?: number | null): string {
  if (mb == null || !Number.isFinite(mb) || mb < 0) return "-";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
