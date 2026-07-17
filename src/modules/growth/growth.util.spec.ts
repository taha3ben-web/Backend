import {
  evaluateProgress,
  isIncentiveActive,
  totalReward,
} from "./incentives.util";
import {
  hashString,
  bucketFraction,
  validateVariants,
  assignVariant,
  Variant,
} from "./ab-testing.util";

describe("incentives.util", () => {
  it("awards reward only when target reached", () => {
    const criteria = { target: 20, rewardMinor: 500000 };
    const below = evaluateProgress("TRIP_COUNT", criteria, { tripCount: 10 });
    expect(below.achieved).toBe(false);
    expect(below.rewardMinor).toBe(0);
    expect(below.ratio).toBe(0.5);

    const met = evaluateProgress("TRIP_COUNT", criteria, { tripCount: 25 });
    expect(met.achieved).toBe(true);
    expect(met.rewardMinor).toBe(500000);
    expect(met.ratio).toBe(1);
  });

  it("handles earnings and acceptance metrics", () => {
    expect(
      evaluateProgress(
        "EARNINGS_THRESHOLD",
        { target: 100000, rewardMinor: 1000 },
        { earningsMinor: 120000 },
      ).achieved,
    ).toBe(true);
    expect(
      evaluateProgress(
        "ACCEPTANCE_RATE",
        { target: 0.9, rewardMinor: 1000 },
        { acceptanceRate: 0.8 },
      ).achieved,
    ).toBe(false);
  });

  it("checks active window and totals rewards", () => {
    expect(isIncentiveActive(0, 100, 50)).toBe(true);
    expect(isIncentiveActive(0, 100, 150)).toBe(false);
    const total = totalReward([
      { progress: 1, target: 1, ratio: 1, achieved: true, rewardMinor: 100 },
      { progress: 0, target: 1, ratio: 0, achieved: false, rewardMinor: 999 },
    ]);
    expect(total).toBe(100);
  });
});

describe("ab-testing.util", () => {
  const variants: Variant[] = [
    { name: "control", weight: 50 },
    { name: "treatment", weight: 50 },
  ];

  it("produces a stable hash", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(bucketFraction("exp", "user")).toBeGreaterThanOrEqual(0);
    expect(bucketFraction("exp", "user")).toBeLessThan(1);
  });

  it("validates variants", () => {
    expect(validateVariants(variants)).toBe(true);
    expect(validateVariants([])).toBe(false);
    expect(validateVariants([{ name: "a", weight: 0 }])).toBe(false);
    expect(
      validateVariants([
        { name: "a", weight: 1 },
        { name: "a", weight: 1 },
      ]),
    ).toBe(false);
  });

  it("assigns deterministically", () => {
    const first = assignVariant("fare_v2", "driver-123", variants);
    const second = assignVariant("fare_v2", "driver-123", variants);
    expect(first).toBe(second);
    expect(["control", "treatment"]).toContain(first);
  });

  it("splits traffic roughly by weight", () => {
    let treatment = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignVariant("exp", `user-${i}`, variants) === "treatment") {
        treatment++;
      }
    }
    const share = treatment / n;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it("throws on invalid variants", () => {
    expect(() => assignVariant("e", "s", [])).toThrow("INVALID_VARIANTS");
  });
});
