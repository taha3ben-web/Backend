import { computeFare, FareRuleValues } from "./pricing.util";

const rule: FareRuleValues = {
  baseFare: 50,
  perKm: 20,
  perMin: 3,
  minFare: 100,
  maxFare: null,
};

describe("computeFare", () => {
  it("sums base + distance + time with no peak", () => {
    // 10km, 20min: 50 + 10*20 + 20*3 = 310
    const r = computeFare(rule, 10, 20 * 60, 1);
    expect(r.fare).toBe(310);
    expect(r.distanceCost).toBe(200);
    expect(r.timeCost).toBe(60);
  });

  it("applies the peak multiplier", () => {
    // 310 * 1.5 = 465
    const r = computeFare(rule, 10, 20 * 60, 1.5);
    expect(r.fare).toBe(465);
  });

  it("enforces the minimum fare", () => {
    // 1km, 2min: 50 + 20 + 6 = 76 -> clamped up to 100
    const r = computeFare(rule, 1, 2 * 60, 1);
    expect(r.fare).toBe(100);
  });

  it("enforces the maximum fare when set", () => {
    const r = computeFare({ ...rule, maxFare: 500 }, 100, 120 * 60, 1);
    expect(r.fare).toBe(500);
  });

  it("rounds the final fare to two decimals", () => {
    // (50 + 200 + 4.5) * 1.15 = 254.5 * 1.15 = 292.675 -> 292.68
    const r = computeFare(rule, 10, 90, 1.15);
    expect(r.fare).toBe(292.68);
    expect(r.timeCost).toBe(4.5);
  });
});
