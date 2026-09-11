import {
  planCommissionFunding,
  prepaidCommissionRequirement,
} from "./settlement.util";
import { buildFareBreakdown } from "../pricing-engine/fare-breakdown.util";

/**
 * تمويل عمولة المنصّة ومتطلّب التغطية المسبقة.
 *
 * كل الأرقام هنا مُدخلات اختبارية: العمولة تأتي دائمًا من `commissionPct`
 * المحلولة من إعدادات اللوحة والملتقطة على الرحلة، لا من أي ثابت في الكود.
 */
describe("planCommissionFunding — مصادر تسديد عمولة الرحلة", () => {
  it("cash ride: the whole commission comes from the driver commission wallet", () => {
    const plan = planCommissionFunding({
      commissionDue: 150,
      commissionCreditAvailable: 0,
      electronicallyCollected: 0, // نقدًا: المنصّة لم تُحصّل شيئًا
    });
    expect(plan).toEqual({
      fromCommissionCredit: 0,
      fromCollection: 0,
      fromDriverWallet: 150,
    });
  });

  it("flaminGO Pay ride: commission is withheld from the collected fare", () => {
    const plan = planCommissionFunding({
      commissionDue: 150,
      commissionCreditAvailable: 0,
      electronicallyCollected: 1000,
    });
    expect(plan).toEqual({
      fromCommissionCredit: 0,
      fromCollection: 150,
      fromDriverWallet: 0,
    });
  });

  it("consumes coupon commission credit before anything else", () => {
    const plan = planCommissionFunding({
      commissionDue: 150,
      commissionCreditAvailable: 200,
      electronicallyCollected: 0,
    });
    expect(plan.fromCommissionCredit).toBe(150);
    expect(plan.fromDriverWallet).toBe(0);
  });

  it("uses the wallet only for what the credit does not cover", () => {
    // رصيد كوبون 50 دج وعمولة 150 دج ⇒ 100 دج من المحفظة.
    const plan = planCommissionFunding({
      commissionDue: 150,
      commissionCreditAvailable: 50,
      electronicallyCollected: 0,
    });
    expect(plan).toEqual({
      fromCommissionCredit: 50,
      fromCollection: 0,
      fromDriverWallet: 100,
    });
  });

  it("falls back to the wallet when the collected fare is smaller than the commission", () => {
    // خصم ضخم: الراكب دفع 80 فقط والعمولة 150 على الأجرة الكاملة.
    const plan = planCommissionFunding({
      commissionDue: 150,
      commissionCreditAvailable: 0,
      electronicallyCollected: 80,
    });
    expect(plan).toEqual({
      fromCommissionCredit: 0,
      fromCollection: 80,
      fromDriverWallet: 70,
    });
  });

  it("always conserves the commission amount across sources", () => {
    const cases = [
      { commissionDue: 0, commissionCreditAvailable: 0, electronicallyCollected: 0 },
      { commissionDue: 33.33, commissionCreditAvailable: 10, electronicallyCollected: 5 },
      { commissionDue: 150, commissionCreditAvailable: 1000, electronicallyCollected: 1000 },
      { commissionDue: 7.77, commissionCreditAvailable: 0, electronicallyCollected: 0 },
    ];
    for (const input of cases) {
      const plan = planCommissionFunding(input);
      const sum =
        plan.fromCommissionCredit + plan.fromCollection + plan.fromDriverWallet;
      expect(Math.round(sum * 100) / 100).toBe(
        Math.round(input.commissionDue * 100) / 100,
      );
    }
  });

  it("never asks for a negative amount from any source", () => {
    const plan = planCommissionFunding({
      commissionDue: -50,
      commissionCreditAvailable: -10,
      electronicallyCollected: -5,
    });
    expect(plan).toEqual({
      fromCommissionCredit: 0,
      fromCollection: 0,
      fromDriverWallet: 0,
    });
  });
});

describe("prepaidCommissionRequirement — شرط قبول الرحلة", () => {
  it("requires full prepaid coverage for a cash ride", () => {
    expect(
      prepaidCommissionRequirement({
        commissionDue: 150,
        commissionCreditAvailable: 0,
        electronicallyCollected: 0,
      }),
    ).toBe(150);
  });

  it("requires nothing prepaid for a fully collected electronic ride", () => {
    expect(
      prepaidCommissionRequirement({
        commissionDue: 150,
        commissionCreditAvailable: 0,
        electronicallyCollected: 1000,
      }),
    ).toBe(0);
  });

  it("counts coupon commission credit towards the requirement", () => {
    expect(
      prepaidCommissionRequirement({
        commissionDue: 150,
        commissionCreditAvailable: 150,
        electronicallyCollected: 0,
      }),
    ).toBe(0);
  });

  it("matches exactly what settlement will debit from the wallet", () => {
    const input = {
      commissionDue: 150,
      commissionCreditAvailable: 40,
      electronicallyCollected: 0,
    };
    expect(prepaidCommissionRequirement(input)).toBe(
      planCommissionFunding(input).fromDriverWallet,
    );
  });
});

describe("driver economics — the three balances never mix", () => {
  /**
   * يحسب الوضع الاقتصادي النهائي للسائق بالنموذج المصحّح، ويقارنه بصافي
   * أرباحه المستحقّ. الثابت المطلوب: تساويان — لا نقص ولا **ائتمان مزدوج**.
   */
  const driverPosition = (input: {
    grossFare: number;
    commissionPct: number;
    discount?: number;
    funding?: "PLATFORM" | "DRIVER" | "SHARED";
    platformShare?: number;
    paymentMethod: "CASH" | "WALLET";
  }) => {
    const breakdown = buildFareBreakdown({
      baseComputedFare: input.grossFare,
      commissionPct: input.commissionPct,
      coupon: input.discount
        ? {
            kind: "FIXED",
            value: input.discount,
            funding: input.funding ?? "PLATFORM",
            platformShare: input.platformShare,
          }
        : null,
    });
    const electronic = input.paymentMethod === "WALLET";
    const collected = electronic ? breakdown.riderPays : 0;
    const plan = planCommissionFunding({
      commissionDue: breakdown.commission,
      commissionCreditAvailable: 0, // رصيد الكوبون يُمنح بعد العمولة
      electronicallyCollected: collected,
    });
    // نقد في يد السائق (الرحلة النقدية فقط).
    const cashInHand = electronic ? 0 : breakdown.riderPays;
    // مستحقّ على المنصّة (الرحلة الإلكترونية فقط).
    const payable = collected - plan.fromCollection;
    // خصم من محفظة العمولة.
    const walletDebit = plan.fromDriverWallet;
    // رصيد عمولة الكوبون الممنوح عن هذه الرحلة (لا يُسحب، يُستهلك لاحقًا).
    const commissionCreditGranted = breakdown.coupon.platformFunded;
    return {
      breakdown,
      cashInHand,
      payable,
      walletDebit,
      commissionCreditGranted,
      economic:
        Math.round(
          (cashInHand + payable - walletDebit + commissionCreditGranted) * 100,
        ) / 100,
    };
  };

  it("cash ride: driver keeps the fare, wallet pays commission, no second credit", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });
    expect(p.breakdown.commission).toBe(150);
    expect(p.breakdown.driverNet).toBe(850);
    expect(p.cashInHand).toBe(1000);
    expect(p.walletDebit).toBe(150);
    // الحرج: لا مستحقّ ولا رصيد إضافي يُضاف للسائق في الرحلة النقدية.
    expect(p.payable).toBe(0);
    expect(p.commissionCreditGranted).toBe(0);
    expect(p.economic).toBe(850);
  });

  it("flaminGO Pay ride: platform collects, withholds commission, owes the net", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      paymentMethod: "WALLET",
    });
    expect(p.cashInHand).toBe(0);
    expect(p.walletDebit).toBe(0);
    expect(p.payable).toBe(850);
    expect(p.economic).toBe(p.breakdown.driverNet);
  });

  it("platform-funded coupon: benefit becomes commission credit, not cash (cash ride)", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      discount: 200,
      funding: "PLATFORM",
      paymentMethod: "CASH",
    });
    expect(p.breakdown.riderPays).toBe(800); // الراكب يدفع 800
    expect(p.cashInHand).toBe(800);
    expect(p.walletDebit).toBe(150);
    expect(p.commissionCreditGranted).toBe(200); // رصيد عمولة لا نقدًا
    expect(p.economic).toBe(850); // = driverNet
    expect(p.breakdown.driverNet).toBe(850);
  });

  it("platform-funded coupon: same driver net on a flaminGO Pay ride", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      discount: 200,
      funding: "PLATFORM",
      paymentMethod: "WALLET",
    });
    expect(p.payable).toBe(650);
    expect(p.commissionCreditGranted).toBe(200);
    expect(p.economic).toBe(850);
  });

  it("driver-funded coupon: the driver absorbs it and gets no commission credit", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      discount: 200,
      funding: "DRIVER",
      paymentMethod: "CASH",
    });
    expect(p.breakdown.driverNet).toBe(650);
    expect(p.commissionCreditGranted).toBe(0);
    expect(p.economic).toBe(650);
  });

  it("percentage coupon behaves identically to its fixed equivalent", () => {
    const percent = buildFareBreakdown({
      baseComputedFare: 1000,
      commissionPct: 15,
      coupon: { kind: "PERCENT", value: 20, funding: "PLATFORM" },
    });
    expect(percent.coupon.discount).toBe(200);
    expect(percent.riderPays).toBe(800);
    expect(percent.coupon.platformFunded).toBe(200);
    expect(percent.driverNet).toBe(850);
  });

  it("shared coupon splits funding and only the platform share becomes credit", () => {
    const p = driverPosition({
      grossFare: 1000,
      commissionPct: 15,
      discount: 200,
      funding: "SHARED",
      platformShare: 0.5,
      paymentMethod: "CASH",
    });
    expect(p.commissionCreditGranted).toBe(100);
    expect(p.breakdown.coupon.driverFunded).toBe(100);
    expect(p.breakdown.driverNet).toBe(750);
    expect(p.economic).toBe(750);
  });
});
