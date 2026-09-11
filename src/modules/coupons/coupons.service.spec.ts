import { CouponsService } from "./coupons.service";
import { BadRequestException } from "@nestjs/common";

/**
 * الكوبون: حساب الخصم، ما يدفعه الراكب، وخمول التسجيل.
 *
 * الجزء المالي من الكوبون (منفعة المنصّة تصبح **رصيد عمولة** للسائق،
 * تُستهلك في عمولة رحلة لاحقة، وليست ربحًا ولا رصيدًا قابلًا للسحب) مُثبَت
 * في `trips/commission-funding.spec.ts` و
 * `financial/trip-settlement-model.spec.ts`. هذا الملف يغطّي طبقة الكوبون
 * نفسها: التحقّق، الحساب، وسياسة التمويل المأخوذة من لوحة التحكم.
 */

type CouponRow = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  maxUses: number | null;
  usedCount: number;
  perUserLimit: number | null;
  firstRideOnly: boolean;
  userId: string | null;
  minFare: number | null;
  maxDiscount: number | null;
  rideClasses: string[];
  cityId: string | null;
  expiresAt: Date | null;
  isActive: boolean;
  fundingSource: "PLATFORM" | "DRIVER" | "SHARED" | null;
  platformShare: number | null;
};

const coupon = (over: Partial<CouponRow> = {}): CouponRow => ({
  id: "coupon-1",
  code: "SAVE20",
  type: "PERCENT",
  value: 20,
  maxUses: null,
  usedCount: 0,
  perUserLimit: null,
  firstRideOnly: false,
  userId: null,
  minFare: null,
  maxDiscount: null,
  rideClasses: [],
  cityId: null,
  expiresAt: null,
  isActive: true,
  fundingSource: null,
  platformShare: null,
  ...over,
});

function buildHarness(row: CouponRow | null, opts?: { redemptions?: number }) {
  const redemptions: Array<{ couponId: string; userId: string; tripId: string | null }> =
    [];
  const state = { row };
  const prisma = {
    coupon: {
      findUnique: jest.fn(async () => state.row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const counter = data.usedCount as
          | { increment?: number; decrement?: number }
          | undefined;
        if (state.row && counter?.increment) state.row.usedCount += 1;
        if (state.row && counter?.decrement) state.row.usedCount -= 1;
        return state.row;
      }),
      updateMany: jest.fn(async () => {
        if (!state.row) return { count: 0 };
        if (state.row.maxUses != null && state.row.usedCount >= state.row.maxUses) {
          return { count: 0 };
        }
        state.row.usedCount += 1;
        return { count: 1 };
      }),
    },
    couponRedemption: {
      count: jest.fn(async () => opts?.redemptions ?? redemptions.length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const dup = redemptions.some((r) => r.tripId === data.tripId);
        if (dup) {
          // يحاكي CouponRedemption.tripId @unique
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            meta: { target: ["tripId"] },
          });
        }
        redemptions.push({
          couponId: data.couponId as string,
          userId: data.userId as string,
          tripId: (data.tripId as string) ?? null,
        });
        return data;
      }),
      deleteMany: jest.fn(async ({ where }: { where: { tripId: string } }) => {
        const before = redemptions.length;
        const kept = redemptions.filter((r) => r.tripId !== where.tripId);
        redemptions.length = 0;
        redemptions.push(...kept);
        return { count: before - redemptions.length };
      }),
    },
    trip: { count: jest.fn(async () => 0) },
  };
  const settings = {
    getValue: jest.fn(async () => ({ source: "PLATFORM", platformShare: 0.5 })),
  };
  const service = new CouponsService(prisma as never, settings as never);
  return { service, prisma, settings, redemptions, state };
}

describe("coupons", () => {
  it("percentage coupon: passenger pays the discounted fare", async () => {
    const h = buildHarness(coupon({ type: "PERCENT", value: 20 }));
    const result = await h.service.validateAndCompute("SAVE20", "u1", 1000);
    expect(result.discount).toBe(200);
    expect(result.finalFare).toBe(800);
  });

  it("fixed-value coupon: passenger pays the discounted fare", async () => {
    const h = buildHarness(coupon({ type: "FIXED", value: 200 }));
    const result = await h.service.validateAndCompute("SAVE20", "u1", 1000);
    expect(result.discount).toBe(200);
    expect(result.finalFare).toBe(800);
  });

  it("caps a percentage coupon at maxDiscount", async () => {
    const h = buildHarness(
      coupon({ type: "PERCENT", value: 50, maxDiscount: 300 }),
    );
    const result = await h.service.validateAndCompute("SAVE20", "u1", 2000);
    expect(result.discount).toBe(300);
    expect(result.finalFare).toBe(1700);
  });

  it("never discounts more than the fare (no negative fare)", async () => {
    const h = buildHarness(coupon({ type: "FIXED", value: 5000 }));
    const result = await h.service.validateAndCompute("SAVE20", "u1", 1000);
    expect(result.discount).toBe(1000);
    expect(result.finalFare).toBe(0);
  });

  it("takes the funding policy from the Dashboard setting when the coupon has none", async () => {
    const h = buildHarness(coupon());
    const result = await h.service.validateAndCompute("SAVE20", "u1", 1000);
    expect(result.fundingSource).toBe("PLATFORM");
    expect(h.settings.getValue).toHaveBeenCalledWith(
      "coupons.funding",
      expect.anything(),
    );
  });

  it("lets a per-coupon funding override beat the global setting", async () => {
    const h = buildHarness(
      coupon({ fundingSource: "SHARED", platformShare: 0.7 }),
    );
    const result = await h.service.validateAndCompute("SAVE20", "u1", 1000);
    expect(result.fundingSource).toBe("SHARED");
    expect(result.platformShare).toBe(0.7);
  });

  it("rejects an expired, inactive or exhausted coupon", async () => {
    await expect(
      buildHarness(coupon({ isActive: false })).service.validateAndCompute(
        "SAVE20",
        "u1",
        1000,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      buildHarness(
        coupon({ expiresAt: new Date(Date.now() - 1000) }),
      ).service.validateAndCompute("SAVE20", "u1", 1000),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      buildHarness(
        coupon({ maxUses: 1, usedCount: 1 }),
      ).service.validateAndCompute("SAVE20", "u1", 1000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enforces the per-user limit from the redemption log", async () => {
    const h = buildHarness(coupon({ perUserLimit: 1 }), { redemptions: 1 });
    await expect(
      h.service.validateAndCompute("SAVE20", "u1", 1000),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("processing the same trip twice is idempotent (unique tripId)", async () => {
    const h = buildHarness(coupon());
    await h.service.redeem("coupon-1", "u1", "trip-1");
    expect(h.state.row?.usedCount).toBe(1);
    // إعادة نفس الرحلة تفشل على القيد الفريد بدل أن تُحتسب مرتين.
    await expect(
      h.service.redeem("coupon-1", "u1", "trip-1"),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(h.redemptions).toHaveLength(1);
  });

  it("does not over-redeem past maxUses under concurrency", async () => {
    const h = buildHarness(coupon({ maxUses: 1 }));
    await h.service.redeem("coupon-1", "u1", "trip-1");
    await expect(
      h.service.redeem("coupon-1", "u2", "trip-2"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.state.row?.usedCount).toBe(1);
  });

  it("releasing a cancelled trip's coupon is idempotent", async () => {
    const h = buildHarness(coupon());
    await h.service.redeem("coupon-1", "u1", "trip-1");
    await h.service.release("coupon-1", "trip-1");
    expect(h.state.row?.usedCount).toBe(0);
    // مرة ثانية: لا صف استرداد ⇒ لا تنقيص مزدوج.
    await h.service.release("coupon-1", "trip-1");
    expect(h.state.row?.usedCount).toBe(0);
  });
});
