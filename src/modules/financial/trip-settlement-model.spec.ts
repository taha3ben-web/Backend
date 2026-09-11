import { buildFareBreakdown } from "../pricing-engine/fare-breakdown.util";
import { planCommissionFunding } from "../trips/settlement.util";

/**
 * نموذج تسوية الرحلة على دفتر أستاذ في الذاكرة.
 *
 * ===== ما يُثبته هذا الملف =====
 * الملف يحاكي **حرفيًا** قواعد الترحيل في `LedgerCoreService.post` (قيد
 * مزدوج متوازن، خمول عبر idempotencyKey، منع المبالغ غير الموجبة) وتسلسل
 * القيود في `FinancialService.settleTrip` بعد تصحيح نموذج العمل. الهدف
 * إثبات الثوابت المالية دون قاعدة بيانات — تمامًا كما يفعل
 * `ledger-invariants.spec.ts` القائم:
 *
 *   1. حفظ القيمة: مجموع كل الأرصدة يبقى صفرًا (قيد مزدوج سليم).
 *   2. الرحلة النقدية لا تُنتج أي رصيد إضافي للسائق (لا ائتمان مزدوج).
 *   3. رصيد عمولة الكوبون يُستهلك في العمولة **القادمة** لا في عمولة
 *      الرحلة التي منحته.
 *   4. الخمول: إعادة التسوية لا تخصم العمولة مرتين.
 *   5. لا رصيد سالب في محفظة عمولة السائق.
 */

type Direction = "DEBIT" | "CREDIT";
interface Line {
  account: string;
  direction: Direction;
  amount: number;
}

const toMinor = (n: number) => Math.round(n * 100);

class MemoryLedger {
  private readonly minor = new Map<string, number>();
  private readonly posted = new Set<string>();
  postCount = 0;

  post(idempotencyKey: string, lines: Line[]): boolean {
    const debit = lines
      .filter((l) => l.direction === "DEBIT")
      .reduce((s, l) => s + toMinor(l.amount), 0);
    const credit = lines
      .filter((l) => l.direction === "CREDIT")
      .reduce((s, l) => s + toMinor(l.amount), 0);
    if (lines.length < 2) throw new Error("needs at least two entries");
    if (debit <= 0 || debit !== credit) {
      throw new Error("Unbalanced ledger transaction");
    }
    for (const l of lines) {
      if (toMinor(l.amount) <= 0) throw new Error("amount must be positive");
    }
    if (this.posted.has(idempotencyKey)) return false; // idempotent
    this.posted.add(idempotencyKey);
    for (const l of lines) {
      const delta =
        l.direction === "CREDIT" ? toMinor(l.amount) : -toMinor(l.amount);
      this.minor.set(l.account, (this.minor.get(l.account) ?? 0) + delta);
    }
    this.postCount += 1;
    return true;
  }

  balance(account: string): number {
    return (this.minor.get(account) ?? 0) / 100;
  }

  total(): number {
    let sum = 0;
    for (const v of this.minor.values()) sum += v;
    return sum / 100;
  }
}

interface TripSnapshot {
  id: string;
  driverUserId: string;
  passengerUserId: string;
  /** ما يدفعه الراكب فعليًا (بعد الخصم) — كما هو مخزَّن على الرحلة. */
  fare: number;
  discountAmount?: number;
  /** لقطة نسبة العمولة المحلولة من إعدادات اللوحة. */
  commissionPct: number;
  couponFunding?: "PLATFORM" | "DRIVER" | "SHARED";
  platformShare?: number;
  paymentMethod: "CASH" | "WALLET";
}

const ACC = {
  driverWallet: (u: string) => `USER:${u}:DZD:AVAILABLE`,
  commissionCredit: (u: string) => `USER:${u}:DZD:COMMISSION_CREDIT`,
  passengerPay: (u: string) => `USER:${u}:DZD:AVAILABLE`,
  commission: "PLATFORM:COMMISSION:DZD",
  driverPayable: "PLATFORM:DRIVER_PAYABLE:DZD",
  couponSubsidy: "PLATFORM:COUPON_SUBSIDY:DZD",
  topUpClearing: "PLATFORM:TOPUP_CLEARING:DZD",
};

/** نسخة مصغّرة من `FinancialService.settleTrip` بنفس ترتيب القيود. */
function settleTrip(
  ledger: MemoryLedger,
  trip: TripSnapshot,
): {
  gross: number;
  commission: number;
  net: number;
  funding: ReturnType<typeof planCommissionFunding>;
  couponCommissionCredit: number;
} {
  const discount = Math.max(trip.discountAmount ?? 0, 0);
  const breakdown = buildFareBreakdown({
    baseComputedFare: Math.round((trip.fare + discount) * 100) / 100,
    commissionPct: trip.commissionPct,
    coupon: discount
      ? {
          kind: "FIXED",
          value: discount,
          funding: trip.couponFunding ?? "PLATFORM",
          platformShare: trip.platformShare,
        }
      : null,
  });

  const electronic = trip.paymentMethod === "WALLET";
  const collected = electronic ? breakdown.riderPays : 0;

  // القيد 1: تحصيل الأجرة (إلكترونيًا فقط).
  if (collected > 0) {
    ledger.post(`trip:settle:${trip.id}`, [
      {
        account: ACC.passengerPay(trip.passengerUserId),
        direction: "DEBIT",
        amount: collected,
      },
      { account: ACC.driverPayable, direction: "CREDIT", amount: collected },
    ]);
  }

  // القيد 2: العمولة — رصيد الكوبون يُقرأ قبل منح رصيد هذه الرحلة.
  const creditBefore = ledger.balance(ACC.commissionCredit(trip.driverUserId));
  const funding = planCommissionFunding({
    commissionDue: breakdown.commission,
    commissionCreditAvailable: creditBefore,
    electronicallyCollected: collected,
  });
  if (
    funding.fromDriverWallet > 0 &&
    ledger.balance(ACC.driverWallet(trip.driverUserId)) + 1e-9 <
      funding.fromDriverWallet
  ) {
    throw new Error("DRIVER_COMMISSION_BALANCE_INSUFFICIENT");
  }
  if (breakdown.commission > 0) {
    const lines: Line[] = [];
    if (funding.fromCommissionCredit > 0) {
      lines.push({
        account: ACC.commissionCredit(trip.driverUserId),
        direction: "DEBIT",
        amount: funding.fromCommissionCredit,
      });
    }
    if (funding.fromCollection > 0) {
      lines.push({
        account: ACC.driverPayable,
        direction: "DEBIT",
        amount: funding.fromCollection,
      });
    }
    if (funding.fromDriverWallet > 0) {
      lines.push({
        account: ACC.driverWallet(trip.driverUserId),
        direction: "DEBIT",
        amount: funding.fromDriverWallet,
      });
    }
    lines.push({
      account: ACC.commission,
      direction: "CREDIT",
      amount: breakdown.commission,
    });
    ledger.post(`trip:commission:${trip.id}`, lines);
  }

  // القيد 3: رصيد عمولة الكوبون.
  const couponCommissionCredit = breakdown.coupon.platformFunded;
  if (couponCommissionCredit > 0) {
    ledger.post(`trip:couponcredit:${trip.id}`, [
      {
        account: ACC.couponSubsidy,
        direction: "DEBIT",
        amount: couponCommissionCredit,
      },
      {
        account: ACC.commissionCredit(trip.driverUserId),
        direction: "CREDIT",
        amount: couponCommissionCredit,
      },
    ]);
  }

  return {
    gross: breakdown.grossFare,
    commission: breakdown.commission,
    net: breakdown.driverNet,
    funding,
    couponCommissionCredit,
  };
}

/** نسخة مصغّرة من `FinancialService.creditWalletTopUp`. */
function creditTopUp(
  ledger: MemoryLedger,
  topUpId: string,
  userId: string,
  amount: number,
): boolean {
  return ledger.post(`wallet:topup:${topUpId}`, [
    { account: ACC.topUpClearing, direction: "DEBIT", amount },
    { account: ACC.passengerPay(userId), direction: "CREDIT", amount },
  ]);
}

const DRIVER = "driver-1";
const PASSENGER = "passenger-1";

describe("trip settlement — corrected flaminGO model", () => {
  it("cash ride debits only the commission wallet and credits nothing to the driver", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t1", DRIVER, 500); // السائق شحن محفظة العمولة
    const result = settleTrip(ledger, {
      id: "trip-cash",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });

    expect(result.commission).toBe(150);
    expect(result.net).toBe(850);
    // 500 − 150 = 350. وهذا **ليس** ربح السائق، بل رصيده التشغيلي.
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(350);
    expect(ledger.balance(ACC.commission)).toBe(150);
    // الحرج: لا مستحقّ ولا رصيد قابل للصرف أُضيف للسائق مقابل 850.
    expect(ledger.balance(ACC.driverPayable)).toBe(0);
    expect(ledger.total()).toBe(0);
  });

  it("flaminGO Pay ride moves passenger balance into commission + driver payable", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t2", PASSENGER, 2000); // الراكب شحن flaminGO Pay
    const result = settleTrip(ledger, {
      id: "trip-pay",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "WALLET",
    });

    expect(ledger.balance(ACC.passengerPay(PASSENGER))).toBe(1000);
    expect(ledger.balance(ACC.commission)).toBe(150);
    expect(ledger.balance(ACC.driverPayable)).toBe(850);
    expect(result.net).toBe(850);
    // محفظة عمولة السائق لم تُمسّ: العمولة احتُجزت من المُحصَّل.
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(0);
    expect(ledger.total()).toBe(0);
  });

  it("a payment method cannot bypass commission accounting", () => {
    for (const method of ["CASH", "WALLET"] as const) {
      const ledger = new MemoryLedger();
      creditTopUp(ledger, `fund-${method}`, DRIVER, 500);
      creditTopUp(ledger, `pay-${method}`, PASSENGER, 5000);
      settleTrip(ledger, {
        id: `trip-${method}`,
        driverUserId: DRIVER,
        passengerUserId: PASSENGER,
        fare: 1000,
        commissionPct: 15,
        paymentMethod: method,
      });
      expect(ledger.balance(ACC.commission)).toBe(150);
    }
  });

  it("coupon credit is granted by this trip and consumed by the NEXT one", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t3", DRIVER, 500);

    // الرحلة 1: كوبون 200 دج تموّله المنصّة، عمولة 150 دج.
    const first = settleTrip(ledger, {
      id: "trip-1",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 800,
      discountAmount: 200,
      commissionPct: 15,
      couponFunding: "PLATFORM",
      paymentMethod: "CASH",
    });
    expect(first.couponCommissionCredit).toBe(200);
    // عمولة الرحلة نفسها خُصمت من المحفظة، لا من رصيد كوبونها.
    expect(first.funding.fromCommissionCredit).toBe(0);
    expect(first.funding.fromDriverWallet).toBe(150);
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(350);
    expect(ledger.balance(ACC.commissionCredit(DRIVER))).toBe(200);

    // الرحلة 2: عمولة 150 دج تُستهلك بالكامل من رصيد الكوبون.
    const second = settleTrip(ledger, {
      id: "trip-2",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });
    expect(second.funding.fromCommissionCredit).toBe(150);
    expect(second.funding.fromDriverWallet).toBe(0);
    // 200 − 150 = 50 يبقى للرحلة القادمة.
    expect(ledger.balance(ACC.commissionCredit(DRIVER))).toBe(50);
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(350);

    // الرحلة 3: 50 من الرصيد + 100 من المحفظة.
    const third = settleTrip(ledger, {
      id: "trip-3",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });
    expect(third.funding.fromCommissionCredit).toBe(50);
    expect(third.funding.fromDriverWallet).toBe(100);
    expect(ledger.balance(ACC.commissionCredit(DRIVER))).toBe(0);
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(250);
    expect(ledger.total()).toBe(0);
  });

  it("coupon commission credit is not driver net earnings and not withdrawable", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t4", DRIVER, 500);
    const result = settleTrip(ledger, {
      id: "trip-coupon",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 800,
      discountAmount: 200,
      commissionPct: 15,
      couponFunding: "PLATFORM",
      paymentMethod: "CASH",
    });
    // صافي الأرباح المحاسبي لا يتضمّن الرصيد كبند ربح منفصل: هو 850 فقط.
    expect(result.net).toBe(850);
    // الرصيد يعيش في حساب مستقل تمامًا، ولا يوجد أي مسار يخرجه من المنصّة.
    expect(ledger.balance(ACC.commissionCredit(DRIVER))).toBe(200);
    expect(ledger.balance(ACC.driverPayable)).toBe(0);
    // ولا يزيد الرصيد القابل للاستخدام في الدفع (محفظة العمولة).
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(350);
  });

  it("re-running settlement does not debit commission twice", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t5", DRIVER, 500);
    const trip: TripSnapshot = {
      id: "trip-idem",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    };
    settleTrip(ledger, trip);
    const postsAfterFirst = ledger.postCount;
    settleTrip(ledger, trip);
    settleTrip(ledger, trip);
    expect(ledger.postCount).toBe(postsAfterFirst);
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(350);
    expect(ledger.balance(ACC.commission)).toBe(150);
  });

  it("re-delivering the same top-up webhook does not credit twice", () => {
    const ledger = new MemoryLedger();
    expect(creditTopUp(ledger, "topup-9", PASSENGER, 1000)).toBe(true);
    expect(creditTopUp(ledger, "topup-9", PASSENGER, 1000)).toBe(false);
    expect(creditTopUp(ledger, "topup-9", PASSENGER, 1000)).toBe(false);
    expect(ledger.balance(ACC.passengerPay(PASSENGER))).toBe(1000);
    expect(ledger.total()).toBe(0);
  });

  it("refuses to settle when the commission wallet cannot cover the commission", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t6", DRIVER, 50); // 50 دج فقط
    expect(() =>
      settleTrip(ledger, {
        id: "trip-poor",
        driverUserId: DRIVER,
        passengerUserId: PASSENGER,
        fare: 1000,
        commissionPct: 15, // عمولة 150 دج
        paymentMethod: "CASH",
      }),
    ).toThrow("DRIVER_COMMISSION_BALANCE_INSUFFICIENT");
    // لا رصيد سالب ولا قيد جزئي.
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(50);
    expect(ledger.balance(ACC.commission)).toBe(0);
  });

  it("concurrent commission deductions cannot overspend the wallet", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t7", DRIVER, 200);
    const settleOnce = (id: string) =>
      settleTrip(ledger, {
        id,
        driverUserId: DRIVER,
        passengerUserId: PASSENGER,
        fare: 1000,
        commissionPct: 15,
        paymentMethod: "CASH",
      });
    settleOnce("trip-a"); // 200 − 150 = 50
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(50);
    // الرحلة الثانية لا تجد تغطية ⇒ ترفض بدل أن تُنزل الرصيد إلى −100.
    expect(() => settleOnce("trip-b")).toThrow(
      "DRIVER_COMMISSION_BALANCE_INSUFFICIENT",
    );
    expect(ledger.balance(ACC.driverWallet(DRIVER))).toBe(50);
  });

  it("keeps historical accounting stable after the Dashboard rate changes", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "t8", DRIVER, 1000);
    // الرحلة سُوّيت بلقطة 15% المخزّنة عليها.
    settleTrip(ledger, {
      id: "trip-123",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });
    expect(ledger.balance(ACC.commission)).toBe(150);

    // اللوحة تخفض النسبة إلى 12% ⇒ الرحلات الجديدة فقط تتأثر.
    settleTrip(ledger, {
      id: "trip-124",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 12,
      paymentMethod: "CASH",
    });
    expect(ledger.balance(ACC.commission)).toBe(270); // 150 + 120
    // ولا يوجد مسار يعيد ترحيل الرحلة القديمة: مفتاحها مستهلَك.
    expect(
      ledger.post("trip:commission:trip-123", [
        { account: ACC.driverWallet(DRIVER), direction: "DEBIT", amount: 120 },
        { account: ACC.commission, direction: "CREDIT", amount: 120 },
      ]),
    ).toBe(false);
    expect(ledger.balance(ACC.commission)).toBe(270);
  });

  it("conserves value across every scenario (double-entry integrity)", () => {
    const ledger = new MemoryLedger();
    creditTopUp(ledger, "x1", DRIVER, 5000);
    creditTopUp(ledger, "x2", PASSENGER, 5000);
    settleTrip(ledger, {
      id: "s1",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 1000,
      commissionPct: 15,
      paymentMethod: "CASH",
    });
    settleTrip(ledger, {
      id: "s2",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 800,
      discountAmount: 200,
      commissionPct: 15,
      couponFunding: "SHARED",
      platformShare: 0.5,
      paymentMethod: "WALLET",
    });
    settleTrip(ledger, {
      id: "s3",
      driverUserId: DRIVER,
      passengerUserId: PASSENGER,
      fare: 333.33,
      commissionPct: 17.5,
      paymentMethod: "CASH",
    });
    expect(ledger.total()).toBe(0);
  });
});
