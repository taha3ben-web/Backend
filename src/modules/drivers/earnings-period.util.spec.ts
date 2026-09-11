import { periodBoundaries, localParts } from "./earnings-period.util";

/**
 * حدود فترات أرباح السائق بتوقيت المنصّة.
 *
 * الخطر الذي تحميه: خادم الإنتاج يعمل بـUTC، فرحلة في 00:30 بتوقيت الجزائر
 * كانت تُحسب في «أمس». الاختبارات تستعمل نطاقًا بإزاحة موجبة (Africa/Algiers
 * = UTC+1) ونطاقًا بإزاحة سالبة للتأكد من أن الحساب ليس مصادفة.
 */
describe("periodBoundaries", () => {
  const TZ = "Africa/Algiers"; // UTC+1 بلا توقيت صيفي

  it("puts a post-midnight local instant in TODAY, not yesterday", () => {
    // 2026-09-11T23:30Z = 2026-09-12T00:30 بتوقيت الجزائر.
    const now = new Date("2026-09-11T23:30:00.000Z");
    const { dayStart } = periodBoundaries(now, TZ);
    // بداية اليوم المحلي 2026-09-12T00:00+01:00 = 2026-09-11T23:00Z
    expect(dayStart.toISOString()).toBe("2026-09-11T23:00:00.000Z");
    expect(now.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
  });

  it("excludes an instant that belongs to the previous local day", () => {
    const now = new Date("2026-09-11T23:30:00.000Z"); // 12 سبتمبر محليًا
    const { dayStart } = periodBoundaries(now, TZ);
    const justBefore = new Date("2026-09-11T22:59:00.000Z"); // 11 سبتمبر محليًا
    expect(justBefore.getTime()).toBeLessThan(dayStart.getTime());
  });

  it("starts the week on Monday", () => {
    // 2026-09-11 هو يوم جمعة.
    const now = new Date("2026-09-11T12:00:00.000Z");
    const parts = localParts(now, TZ);
    expect(parts.weekday).toBe(5); // Friday
    const { weekStart, dayStart } = periodBoundaries(now, TZ);
    // الجمعة − 4 أيام = الاثنين.
    expect(dayStart.getTime() - weekStart.getTime()).toBe(
      4 * 24 * 60 * 60 * 1000,
    );
  });

  it("treats Sunday as the last day of the week (Monday start)", () => {
    // 2026-09-13 هو يوم أحد.
    const now = new Date("2026-09-13T12:00:00.000Z");
    expect(localParts(now, TZ).weekday).toBe(0);
    const { weekStart, dayStart } = periodBoundaries(now, TZ);
    expect(dayStart.getTime() - weekStart.getTime()).toBe(
      6 * 24 * 60 * 60 * 1000,
    );
  });

  it("anchors month and year to local midnight of the 1st", () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    const { monthStart, yearStart } = periodBoundaries(now, TZ);
    expect(monthStart.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(yearStart.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("orders the boundaries year ≤ month ≤ week? no — week can precede month", () => {
    const now = new Date("2026-09-02T12:00:00.000Z"); // أربعاء أول الشهر
    const { dayStart, weekStart, monthStart, yearStart } = periodBoundaries(
      now,
      TZ,
    );
    expect(yearStart.getTime()).toBeLessThanOrEqual(monthStart.getTime());
    expect(monthStart.getTime()).toBeLessThanOrEqual(dayStart.getTime());
    // الأسبوع الذي يبدأ الاثنين 31 أغسطس يسبق بداية سبتمبر — سلوك صحيح
    // ومقصود: «هذا الأسبوع» فترة تقويمية مستقلة عن «هذا الشهر».
    expect(weekStart.getTime()).toBeLessThan(monthStart.getTime());
  });

  it("works for a negative-offset timezone too", () => {
    // 2026-09-12T02:00Z = 2026-09-11T22:00 في New York (UTC−4 صيفًا).
    const now = new Date("2026-09-12T02:00:00.000Z");
    const { dayStart } = periodBoundaries(now, "America/New_York");
    expect(dayStart.toISOString()).toBe("2026-09-11T04:00:00.000Z");
  });

  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    const now = new Date("2026-09-11T12:00:00.000Z");
    const result = periodBoundaries(now, "Not/AZone");
    expect(result.timezone).toBe("UTC");
    expect(result.dayStart.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
});
