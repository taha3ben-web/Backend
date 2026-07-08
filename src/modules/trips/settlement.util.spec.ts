import { computeSettlement } from "./settlement.util";

describe("computeSettlement", () => {
  it("splits the fare with the default 15% commission", () => {
    const s = computeSettlement(1000, 0.15);
    expect(s).toEqual({ gross: 1000, commission: 150, net: 850 });
  });

  it("rounds commission and net to two decimals", () => {
    // 333.33 * 0.15 = 49.9995 -> 50 ; net = 283.33
    const s = computeSettlement(333.33, 0.15);
    expect(s.commission).toBe(50);
    expect(s.net).toBe(283.33);
  });

  it("handles a zero fare", () => {
    expect(computeSettlement(0, 0.15)).toEqual({
      gross: 0,
      commission: 0,
      net: 0,
    });
  });

  it("supports a custom commission rate", () => {
    const s = computeSettlement(200, 0.25);
    expect(s.commission).toBe(50);
    expect(s.net).toBe(150);
  });

  it("keeps commission + net equal to gross", () => {
    const s = computeSettlement(1234.56, 0.15);
    expect(Math.round((s.commission + s.net) * 100) / 100).toBe(s.gross);
  });
});
