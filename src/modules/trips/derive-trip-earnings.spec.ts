import { deriveTripEarnings } from "./settlement.util";

describe("deriveTripEarnings (اشتقاق الأرباح من دفتر الأستاذ)", () => {
  it("يشتق gross/net/commission من قيود تسوية رحلة نقدية", () => {
    // fare=1000, commission=15% => net=850, commission=150
    const result = deriveTripEarnings([
      { direction: "DEBIT", amount: 1000, accountCode: "PLATFORM:CASH_CLEARING:DZD" },
      { direction: "CREDIT", amount: 850, accountCode: "USER:driver-1:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 150, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(result).toEqual({ gross: 1000, net: 850, commission: 150 });
  });

  it("يتعامل مع دفع من محفظة الراكب (الخصم من حساب USER لا يُحتسب net)", () => {
    // المدين على حساب الراكب (USER) — net يحتسب من الدائن فقط
    const result = deriveTripEarnings([
      { direction: "DEBIT", amount: 1000, accountCode: "USER:rider-9:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 850, accountCode: "USER:driver-1:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 150, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(result).toEqual({ gross: 1000, net: 850, commission: 150 });
  });

  it("يجمع قيودًا دائنة متعددة لنفس السائق ويقرّب لمنزلتين", () => {
    const result = deriveTripEarnings([
      { direction: "DEBIT", amount: 99.99, accountCode: "PLATFORM:CARD_RECEIVABLE:DZD" },
      { direction: "CREDIT", amount: 84.99, accountCode: "USER:driver-1:DZD:AVAILABLE" },
      { direction: "CREDIT", amount: 15.0, accountCode: "PLATFORM:COMMISSION:DZD" },
    ]);
    expect(result.gross).toBeCloseTo(99.99, 2);
    expect(result.net).toBeCloseTo(84.99, 2);
    expect(result.commission).toBeCloseTo(15.0, 2);
  });
});
