import {
  MONEY_SCALE,
  fromMinorUnits,
  round2,
  roundMoney,
  toMinorUnits,
} from "./money.util";

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

  describe("minor units (تمثيل موحّد للمال)", () => {
    it("MONEY_SCALE يساوي 100", () => {
      expect(MONEY_SCALE).toBe(100);
    });

    it("toMinorUnits يحوّل التمثيل الرئيسي إلى وحدات صغرى صحيحة", () => {
      expect(toMinorUnits(12.34)).toBe(1234);
      expect(toMinorUnits(0)).toBe(0);
      expect(toMinorUnits(99.99)).toBe(9999);
      // تصحيح خطأ الفاصلة العائمة عند حدّ نصف السنت
      expect(toMinorUnits(292.675)).toBe(29268);
    });

    it("toMinorUnits آمن للمدخلات غير المنتهية", () => {
      expect(toMinorUnits(NaN)).toBe(0);
      expect(toMinorUnits(Infinity)).toBe(0);
    });

    it("fromMinorUnits يعكس toMinorUnits", () => {
      expect(fromMinorUnits(1234)).toBe(12.34);
      expect(fromMinorUnits(9999)).toBe(99.99);
      expect(fromMinorUnits(0)).toBe(0);
      expect(fromMinorUnits(toMinorUnits(292.68))).toBe(292.68);
    });

    it("يدعم مقاييس أخرى غير 100", () => {
      expect(toMinorUnits(1.5, 1000)).toBe(1500);
      expect(fromMinorUnits(1500, 1000)).toBe(1.5);
    });
  });
});
