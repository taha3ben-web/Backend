import {
  buildFareBreakdown,
  computeCancellationFee,
  computeCouponDiscount,
  computeWaitingCharge,
} from "./fare-breakdown.util";

describe("computeWaitingCharge", () => {
  const policy = { freeSeconds: 180, perMinute: 10, maxCharge: 100 };

  it("is free within the grace window", () => {
    expect(computeWaitingCharge(120, policy)).toBe(0);
    expect(computeWaitingCharge(180, policy)).toBe(0);
  });

  it("charges ceil of extra minutes", () => {
    // 180 free + 61s over => ceil(61/60)=2 minutes => 20
    expect(computeWaitingCharge(241, policy)).toBe(20);
  });

  it("caps at maxCharge", () => {
    expect(computeWaitingCharge(3600, policy)).toBe(100);
  });

  it("returns 0 without a policy", () => {
    expect(computeWaitingCharge(999, null)).toBe(0);
  });
});

describe("computeCancellationFee", () => {
  const policy = { graceSeconds: 120, feeAfterAccept: 50, feeAfterArrival: 80 };

  it("never charges before accept", () => {
    expect(computeCancellationFee("BEFORE_ACCEPT", policy, 999)).toBe(0);
  });

  it("is free within grace after accept", () => {
    expect(computeCancellationFee("AFTER_ACCEPT", policy, 100)).toBe(0);
  });

  it("charges after grace", () => {
    expect(computeCancellationFee("AFTER_ACCEPT", policy, 121)).toBe(50);
  });

  it("charges arrival fee", () => {
    expect(computeCancellationFee("AFTER_ARRIVAL", policy, 0)).toBe(80);
  });
});

describe("computeCouponDiscount", () => {
  it("applies percent capped by maxDiscount", () => {
    const c = computeCouponDiscount(200, {
      kind: "PERCENT",
      value: 50,
      maxDiscount: 60,
      funding: "PLATFORM",
    });
    expect(c.discount).toBe(60);
    expect(c.platformFunded).toBe(60);
    expect(c.driverFunded).toBe(0);
  });

  it("never exceeds the amount", () => {
    const c = computeCouponDiscount(30, {
      kind: "FIXED",
      value: 100,
      funding: "DRIVER",
    });
    expect(c.discount).toBe(30);
    expect(c.driverFunded).toBe(30);
    expect(c.platformFunded).toBe(0);
  });

  it("splits a shared coupon", () => {
    const c = computeCouponDiscount(100, {
      kind: "FIXED",
      value: 40,
      funding: "SHARED",
      platformShare: 0.25,
    });
    expect(c.discount).toBe(40);
    expect(c.platformFunded).toBe(10);
    expect(c.driverFunded).toBe(30);
  });
});

describe("buildFareBreakdown", () => {
  it("passes tolls to the driver and excludes them from commission", () => {
    const b = buildFareBreakdown({
      baseComputedFare: 300,
      commissionPct: 20,
      tolls: 50,
    });
    expect(b.commissionBase).toBe(300);
    expect(b.grossFare).toBe(350);
    expect(b.commission).toBe(60); // 20% of 300 only
    expect(b.driverEarnings).toBe(290); // 350 - 60
    expect(b.riderPays).toBe(350);
    // conservation
    expect(b.driverNet + b.platformNet).toBe(b.riderPays);
  });

  it("adds waiting + surcharges into the commission base", () => {
    const b = buildFareBreakdown({
      baseComputedFare: 200,
      commissionPct: 10,
      surcharges: 30,
      waitingSeconds: 300,
      waitingPolicy: { freeSeconds: 60, perMinute: 12 },
    });
    // waiting: ceil((300-60)/60)=4 * 12 = 48
    expect(b.components.waitingCharge).toBe(48);
    expect(b.commissionBase).toBe(278);
    expect(b.commission).toBe(27.8);
  });

  it("keeps the driver whole when the platform funds the coupon", () => {
    const b = buildFareBreakdown({
      baseComputedFare: 100,
      commissionPct: 20,
      coupon: { kind: "PERCENT", value: 50, funding: "PLATFORM" },
    });
    expect(b.coupon.discount).toBe(50);
    expect(b.riderPays).toBe(50);
    expect(b.driverNet).toBe(80); // unchanged: 100 - 20 commission
    expect(b.platformNet).toBe(-30); // 20 commission - 50 funded
    expect(b.driverNet + b.platformNet).toBe(b.riderPays);
  });

  it("charges the driver when the driver funds the coupon", () => {
    const b = buildFareBreakdown({
      baseComputedFare: 100,
      commissionPct: 20,
      coupon: { kind: "FIXED", value: 30, funding: "DRIVER" },
    });
    expect(b.riderPays).toBe(70);
    expect(b.driverNet).toBe(50); // 80 - 30
    expect(b.platformNet).toBe(20); // unchanged
    expect(b.driverNet + b.platformNet).toBe(b.riderPays);
  });
});
