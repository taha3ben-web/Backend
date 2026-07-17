import { computeSettlement, deriveTripEarnings } from "./settlement.util";

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

describe("deriveTripEarnings (اشتقاق الأرباح من دفتر الأستاذ)", () => {
  it("يشتقّ gross/net/commission من قيود التسوية", () => {
    const derived = deriveTripEarnings([
      { direction: "DEBIT", amount: 1000, accountCode: "PLATFORM:CASH_CLEARING:DZD" },
      { direction: "CREDIT", amount: 850, accountCode: "USER:driver-1:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 150, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(derived).toEqual({ gross: 1000, commission: 150, net: 850 });
  });

  it("يطابق computeSettlement لنفس الأجرة (الإسقاط = الحقيقة)", () => {
    const s = computeSettlement(1234.56, 0.15);
    const derived = deriveTripEarnings([
      { direction: "DEBIT", amount: s.gross, accountCode: "PLATFORM:CARD_RECEIVABLE:DZD" },
      { direction: "CREDIT", amount: s.net, accountCode: "USER:driver-9:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: s.commission, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(derived).toEqual(s);
  });

  it("يتجاهل القيود غير الخاصة بحساب المستخدم عند حساب الصافي", () => {
    const derived = deriveTripEarnings([
      { direction: "DEBIT", amount: 500, accountCode: "PLATFORM:CASH_CLEARING:DZD" },
      { direction: "CREDIT", amount: 425, accountCode: "USER:driver-2:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 75, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(derived.net).toBe(425);
    expect(derived.commission).toBe(75);
  });
});
