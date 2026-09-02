import {
  DEFAULT_LEADERBOARD_CONFIG,
  LEADERBOARD_LIMITS,
  compareForRanking,
  computeGap,
  computeScore,
  isRuleActive,
  legacyScopeName,
  legacyScoreUnitLabel,
  normalizeLeaderboardConfig,
  normalizeTopLimit,
  parseLeaderboardPeriod,
  parseLeaderboardScope,
  rankRows,
  resolveCoefficients,
  resolvePeriodWindow,
  resolveScoreUnitKey,
  type LeaderboardRule,
} from "./leaderboard.util";

const row = (
  driverId: string,
  score: number,
  rating = 5,
  completedTrips = score,
) => ({ driverId, score, rating, completedTrips });

describe("leaderboard config normalization", () => {
  it("يعيد الإعداد الافتراضي عند غياب القيمة", () => {
    const { config, warnings } = normalizeLeaderboardConfig(undefined);
    expect(config).toEqual(DEFAULT_LEADERBOARD_CONFIG);
    expect(warnings).toHaveLength(0);
  });

  it("الافتراضي يعيد إنتاج سلوك اليوم: رحلة مكتملة = نقطة واحدة فقط", () => {
    const coeffs = resolveCoefficients(DEFAULT_LEADERBOARD_CONFIG);
    expect(coeffs.perCompletedTrip).toBe(1);
    expect(coeffs.perPeakTrip).toBe(0);
    expect(coeffs.ratingBonus).toBe(0);
    expect(coeffs.perDriverCancellation).toBe(0);
    expect(coeffs.campaignMultiplier).toBe(1);
    expect(
      computeScore(coeffs, {
        completedTrips: 12,
        peakTrips: 4,
        driverCancellations: 3,
        rating: 5,
      }),
    ).toBe(12);
  });

  it("يسقط أنواع القواعد غير المدعومة بدل تجاهلها صامتًا", () => {
    const { config, warnings } = normalizeLeaderboardConfig({
      rules: [{ key: "x", type: "ACCEPTANCE_RATE", enabled: true, value: 5 }],
    });
    expect(config.rules).toHaveLength(0);
    expect(warnings.join(" ")).toContain("ACCEPTANCE_RATE");
  });

  it("يقصّ القيم الخارجة عن المدى ولا يقبل مضاعِفًا خرافيًا", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        { key: "c", type: "CAMPAIGN_MULTIPLIER", enabled: true, value: 999 },
      ],
    });
    expect(config.rules[0].value).toBe(LEADERBOARD_LIMITS.maxMultiplier);
  });

  it("يحصر topLimit وcacheTtlSec داخل الحدود", () => {
    const { config } = normalizeLeaderboardConfig({
      topLimit: 5000,
      cacheTtlSec: 99999,
    });
    expect(config.topLimit).toBe(LEADERBOARD_LIMITS.maxTop);
    expect(config.cacheTtlSec).toBe(LEADERBOARD_LIMITS.maxCacheTtlSec);
  });

  it("يرفض قاعدة مكرّرة بنفس المفتاح", () => {
    const { config, warnings } = normalizeLeaderboardConfig({
      rules: [
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 1 },
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 9 },
      ],
    });
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].value).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("قاعدة بنطاق ولاية بلا wilayaId تُعامل كوطنية مع تحذير", () => {
    const { config, warnings } = normalizeLeaderboardConfig({
      rules: [
        {
          key: "w",
          type: "COMPLETED_TRIP",
          enabled: true,
          value: 2,
          scope: "WILAYA",
        },
      ],
    });
    expect(config.rules[0].scope).toBe("ALL");
    expect(warnings.join(" ")).toContain("wilayaId");
  });

  it("لا ينهار على قيمة ليست كائنًا", () => {
    const { config, warnings } = normalizeLeaderboardConfig("broken");
    expect(config.rules.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("rule effectiveness (تواريخ السريان والنطاق)", () => {
  const base: LeaderboardRule = {
    key: "campaign",
    type: "COMPLETED_TRIP",
    enabled: true,
    value: 5,
    scope: "ALL",
    priority: 1,
  };
  const now = new Date("2026-09-02T00:00:00Z");

  it("قاعدة معطّلة لا تُطبّق", () => {
    expect(isRuleActive({ ...base, enabled: false }, now, null)).toBe(false);
  });

  it("قاعدة لم يبدأ سريانها لا تُطبّق", () => {
    expect(
      isRuleActive({ ...base, startAt: "2026-10-01T00:00:00Z" }, now, null),
    ).toBe(false);
  });

  it("قاعدة منتهية لا تُطبّق", () => {
    expect(
      isRuleActive({ ...base, endAt: "2026-08-01T00:00:00Z" }, now, null),
    ).toBe(false);
  });

  it("قاعدة ولاية تُطبّق على ولايتها فقط", () => {
    const rule: LeaderboardRule = {
      ...base,
      scope: "WILAYA",
      wilayaId: "w-16",
    };
    expect(isRuleActive(rule, now, "w-16")).toBe(true);
    expect(isRuleActive(rule, now, "w-31")).toBe(false);
    expect(isRuleActive(rule, now, null)).toBe(false);
  });
});

describe("score formula", () => {
  it("يجمع الرحلات والذروة ومكافأة التقييم ويخصم الإلغاء", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 10 },
        {
          key: "p",
          type: "PEAK_HOUR_TRIP",
          enabled: true,
          value: 5,
          startHour: 17,
          endHour: 21,
        },
        {
          key: "r",
          type: "RATING_BONUS",
          enabled: true,
          value: 100,
          threshold: 4.8,
        },
        { key: "c", type: "CANCELLATION_PENALTY", enabled: true, value: 20 },
      ],
    });
    const coeffs = resolveCoefficients(config);
    // 10*10 + 4*5 + 100 - 2*20 = 180
    expect(
      computeScore(coeffs, {
        completedTrips: 10,
        peakTrips: 4,
        driverCancellations: 2,
        rating: 4.9,
      }),
    ).toBe(180);
  });

  it("لا يمنح مكافأة التقييم تحت العتبة", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        {
          key: "r",
          type: "RATING_BONUS",
          enabled: true,
          value: 100,
          threshold: 4.8,
        },
      ],
    });
    expect(
      computeScore(resolveCoefficients(config), {
        completedTrips: 0,
        peakTrips: 0,
        driverCancellations: 0,
        rating: 4.7,
      }),
    ).toBe(0);
  });

  it("المضاعِف يُطبّق على المجموع لا على بند واحد", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 10 },
        { key: "m", type: "CAMPAIGN_MULTIPLIER", enabled: true, value: 2 },
      ],
    });
    expect(
      computeScore(resolveCoefficients(config), {
        completedTrips: 3,
        peakTrips: 0,
        driverCancellations: 0,
        rating: 5,
      }),
    ).toBe(60);
  });

  it("النقاط لا تنزل تحت الصفر مهما بلغ الخصم", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 1 },
        { key: "c", type: "CANCELLATION_PENALTY", enabled: true, value: 50 },
      ],
    });
    expect(
      computeScore(resolveCoefficients(config), {
        completedTrips: 1,
        peakTrips: 0,
        driverCancellations: 10,
        rating: 5,
      }),
    ).toBe(0);
  });

  it("قاعدة معطّلة لا تؤثر على النتيجة", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [
        { key: "t", type: "COMPLETED_TRIP", enabled: true, value: 1 },
        { key: "c", type: "CANCELLATION_PENALTY", enabled: false, value: 50 },
      ],
    });
    expect(
      computeScore(resolveCoefficients(config), {
        completedTrips: 4,
        peakTrips: 0,
        driverCancellations: 9,
        rating: 5,
      }),
    ).toBe(4);
  });
});

describe("ranking determinism", () => {
  it("الأعلى نقاطًا أولًا", () => {
    const ranked = rankRows([row("a", 10), row("b", 30), row("c", 20)]);
    expect(ranked.map((r) => r.driverId)).toEqual(["b", "c", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("عند تساوي النقاط يفصل التقييم ثم الرحلات ثم المعرّف", () => {
    const ranked = rankRows([
      row("d-2", 100, 4.5, 10),
      row("d-1", 100, 4.9, 10),
      row("d-3", 100, 4.5, 20),
    ]);
    expect(ranked.map((r) => r.driverId)).toEqual(["d-1", "d-3", "d-2"]);
  });

  it("تساوٍ كامل يُفصل بالمعرّف تصاعديًا", () => {
    const ranked = rankRows([row("zz", 5, 5, 5), row("aa", 5, 5, 5)]);
    expect(ranked.map((r) => r.driverId)).toEqual(["aa", "zz"]);
  });

  it("نفس المدخلات بترتيب مختلف تعطي نفس المخرجات", () => {
    const input = [row("a", 7, 4.2, 7), row("b", 7, 4.2, 7), row("c", 9, 3, 9)];
    const first = rankRows(input).map((r) => `${r.rank}:${r.driverId}`);
    const second = rankRows([...input].reverse()).map(
      (r) => `${r.rank}:${r.driverId}`,
    );
    expect(second).toEqual(first);
  });

  it("المراكز ordinal متتالية بلا تكرار لأن الفاصل كلّي", () => {
    const ranked = rankRows([
      row("a", 5, 5, 5),
      row("b", 5, 5, 5),
      row("c", 5, 5, 5),
      row("d", 4, 5, 4),
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("لوحة فارغة لا تنهار", () => {
    expect(rankRows([])).toEqual([]);
  });

  it("سائق واحد يحصل على المركز الأول", () => {
    expect(rankRows([row("solo", 0, 5, 0)])[0].rank).toBe(1);
  });

  it("compareForRanking متسق مع نفسه", () => {
    const a = row("a", 5, 4, 5);
    const b = row("b", 5, 4, 5);
    expect(Math.sign(compareForRanking(a, b))).toBe(
      -Math.sign(compareForRanking(b, a)),
    );
  });
});

describe("score gap", () => {
  it("يحسب الفارق للمركز الذي يسبق وللمتصدر", () => {
    expect(computeGap(8940, 9010, 9850)).toEqual({
      pointsToNext: 70,
      pointsToLeader: 910,
    });
  });

  it("المتصدر فارقه صفر لا سالب", () => {
    expect(computeGap(9850, null, 9850)).toEqual({
      pointsToNext: null,
      pointsToLeader: 0,
    });
  });

  it("سائق بلا نتيجة لا يحصل على فوارق مخترعة", () => {
    expect(computeGap(null, 100, 500)).toEqual({
      pointsToNext: null,
      pointsToLeader: null,
    });
  });
});

describe("period windows", () => {
  it("ALL_TIME بلا حدود", () => {
    const w = resolvePeriodWindow("ALL_TIME");
    expect(w.period).toBe("ALL_TIME");
    expect(w.from).toBeNull();
    expect(w.to).toBeNull();
  });

  it("WEEKLY يبدأ الاثنين افتراضيًا", () => {
    // 2026-09-02 هو يوم الأربعاء
    const w = resolvePeriodWindow("WEEKLY", new Date("2026-09-02T10:00:00Z"));
    expect(w.from?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(w.to?.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("WEEKLY يدعم بداية الأحد", () => {
    const w = resolvePeriodWindow(
      "WEEKLY",
      new Date("2026-09-02T10:00:00Z"),
      0,
    );
    expect(w.from?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  it("MONTHLY من أول الشهر إلى أول الشهر التالي", () => {
    const w = resolvePeriodWindow("MONTHLY", new Date("2026-09-15T10:00:00Z"));
    expect(w.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.to?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("MONTHLY يعبر نهاية السنة صحيحًا", () => {
    const w = resolvePeriodWindow("MONTHLY", new Date("2026-12-20T10:00:00Z"));
    expect(w.to?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("query parsing (لا ثقة في العميل)", () => {
  it("يقبل الفترات المعروفة فقط", () => {
    expect(parseLeaderboardPeriod("weekly")).toBe("WEEKLY");
    expect(parseLeaderboardPeriod("ALL-TIME")).toBe("ALL_TIME");
    expect(parseLeaderboardPeriod("since_forever")).toBeNull();
    expect(parseLeaderboardPeriod(42)).toBeNull();
  });

  it("يحافظ على أسماء النطاق القديمة المنشورة", () => {
    expect(parseLeaderboardScope("city")).toBe("WILAYA");
    expect(parseLeaderboardScope("country")).toBe("NATIONAL");
    expect(parseLeaderboardScope("wilaya")).toBe("WILAYA");
    expect(parseLeaderboardScope("national")).toBe("NATIONAL");
    expect(parseLeaderboardScope("planet")).toBeNull();
    expect(legacyScopeName("NATIONAL")).toBe("country");
    expect(legacyScopeName("WILAYA")).toBe("city");
  });

  it("limit من العميل يُقصّ إلى المدى المسموح", () => {
    expect(normalizeTopLimit("1000", 20)).toBe(LEADERBOARD_LIMITS.maxTop);
    expect(normalizeTopLimit("1", 20)).toBe(LEADERBOARD_LIMITS.minTop);
    expect(normalizeTopLimit("abc", 20)).toBe(20);
    expect(normalizeTopLimit(undefined, 20)).toBe(20);
  });
});

describe("i18n لوحدة النقاط", () => {
  it("TRIP عندما تكون رحلة = نقطة فقط", () => {
    expect(
      resolveScoreUnitKey(resolveCoefficients(DEFAULT_LEADERBOARD_CONFIG)),
    ).toBe("TRIP");
  });

  it("POINT عند وجود أوزان مركّبة", () => {
    const { config } = normalizeLeaderboardConfig({
      rules: [{ key: "t", type: "COMPLETED_TRIP", enabled: true, value: 10 }],
    });
    expect(resolveScoreUnitKey(resolveCoefficients(config))).toBe("POINT");
  });

  it("الحقل القديم يبقى نصًا عربيًا للتوافق الخلفي فقط", () => {
    expect(legacyScoreUnitLabel("TRIP")).toBe("رحلة");
    expect(legacyScoreUnitLabel("POINT")).toBe("نقطة");
  });
});
