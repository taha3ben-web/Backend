import { round2, roundMoney } from "./money.util";

describe("money.util", () => {
  describe("round2", () => {
    it("rounds half up at the cent boundary despite float error", () => {
      // 292.675 is stored as 292.67499999999995 -> naive Math.round gives 292.67
      expect(round2(292.675)).toBe(292.68);
      expect(round2((50 + 200 + 4.5) * 1.15)).toBe(292.68);
    });

    it("leaves already-2dp values untouched", () => {
      expect(round2(310)).toBe(310);
      expect(round2(99.99)).toBe(99.99);
      expect(round2(0)).toBe(0);
    });

    it("rounds down when below the half boundary", () => {
      expect(round2(292.674)).toBe(292.67);
      expect(round2(1.014)).toBe(1.01);
    });

    it("handles negative amounts symmetrically", () => {
      expect(round2(-292.675)).toBe(-292.68);
      expect(round2(-1.005)).toBe(-1.01);
    });

    it("is safe for non-finite input", () => {
      expect(round2(NaN)).toBe(0);
      expect(round2(Infinity)).toBe(0);
    });
  });

  describe("roundMoney", () => {
    it("supports custom decimal places", () => {
      expect(roundMoney(1.23456, 3)).toBe(1.235);
      expect(roundMoney(1.005, 2)).toBe(1.01);
      expect(roundMoney(7, 0)).toBe(7);
    });
  });
});
