import { FinancialService } from "./financial.service";
import { AppException } from "../../common/api/app.exception";
import { httpStatusForCode } from "../../common/api/api-error.util";

/**
 * حارس تغطية عمولة السائق **قبل** إسناد الرحلة.
 *
 * ===== لماذا هذا الحارس ولماذا اختباره منفصلًا =====
 * العمولة في نموذج flaminGO مسبقة الدفع: تُخصم من محفظة عمولة السائق وقت
 * التسوية. بدون فحص وقت القبول يقبل سائق بمحفظة فارغة رحلةً تفشل تسويتها
 * لاحقًا وتبقى معلّقة في طابور إعادة المحاولة — وهي أسوأ نتيجة ممكنة: الرحلة
 * حدثت، والراكب دفع، والمحاسبة معلّقة.
 *
 * الاختبار يستدعي الدالة الحقيقية بعميل معاملة مُصطنع (نفس نمط
 * `driver-self-trip-status.spec.ts`) لأن ما يهمّ هو القرار: أي رصيد يُقرأ،
 * وكم يُطلب، ومتى يُرفض. الخصم الفعلي مُثبَت في
 * `trip-settlement-model.spec.ts`.
 */

function buildService(balances: {
  wallet?: number | null;
  commissionCredit?: number | null;
}) {
  const lookups: string[] = [];
  const client = {
    financialAccount: {
      findUnique: jest.fn(
        async ({ where }: { where: { code: string } }) => {
          lookups.push(where.code);
          if (where.code.endsWith(":AVAILABLE")) {
            return balances.wallet == null
              ? null
              : { balanceCache: balances.wallet };
          }
          if (where.code.endsWith(":COMMISSION_CREDIT")) {
            return balances.commissionCredit == null
              ? null
              : { balanceCache: balances.commissionCredit };
          }
          return null;
        },
      ),
    },
  };
  // بقية تبعيات FinancialService غير مستعملة في هذا المسار.
  const service = new FinancialService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, client, lookups };
}

const CASH = { electronicallyCollected: 0 };

describe("assertDriverCommissionCoverage — prepaid commission gate", () => {
  it("passes when the commission wallet covers the commission (cash ride)", async () => {
    const h = buildService({ wallet: 500 });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 150,
        ...CASH,
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks the ride when the wallet cannot cover it, with a clear domain error", async () => {
    const h = buildService({ wallet: 50 });
    let error: unknown;
    try {
      await h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 150,
        tripId: "trip-9",
        ...CASH,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AppException);
    const app = error as AppException;
    expect(app.code).toBe("DRIVER_COMMISSION_BALANCE_INSUFFICIENT");
    // 402 Payment Required — قابل للتصرّف من التطبيق (اعرض شاشة الشحن).
    expect(httpStatusForCode("DRIVER_COMMISSION_BALANCE_INSUFFICIENT")).toBe(
      402,
    );
    // التفاصيل تكفي التطبيق لعرض المبلغ الناقص بلا استعلام ثانٍ.
    expect(app.details).toMatchObject({
      tripId: "trip-9",
      required: 150,
      walletBalance: 50,
      commissionCredit: 0,
      currency: "DZD",
    });
  });

  it("treats a missing account as a zero balance, not as a pass", async () => {
    // سائق جديد بلا أي حساب في الدفتر: لا يجوز أن يمرّ الفحص بالصمت.
    const h = buildService({ wallet: null, commissionCredit: null });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-new",
        currency: "DZD",
        commissionDue: 150,
        ...CASH,
      }),
    ).rejects.toMatchObject({
      code: "DRIVER_COMMISSION_BALANCE_INSUFFICIENT",
    });
  });

  it("counts the coupon commission credit towards the requirement", async () => {
    // محفظة فارغة لكن رصيد كوبون يغطّي العمولة بالكامل ⇒ يُسمح.
    const h = buildService({ wallet: 0, commissionCredit: 200 });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 150,
        ...CASH,
      }),
    ).resolves.toBeUndefined();
  });

  it("requires only the part the coupon credit does not cover", async () => {
    // رصيد كوبون 50 وعمولة 150 ⇒ المطلوب من المحفظة 100.
    const tooLittle = buildService({ wallet: 99, commissionCredit: 50 });
    await expect(
      tooLittle.service.assertDriverCommissionCoverage(
        tooLittle.client as never,
        {
          driverUserId: "driver-1",
          currency: "DZD",
          commissionDue: 150,
          ...CASH,
        },
      ),
    ).rejects.toMatchObject({ code: "DRIVER_COMMISSION_BALANCE_INSUFFICIENT" });

    const justEnough = buildService({ wallet: 100, commissionCredit: 50 });
    await expect(
      justEnough.service.assertDriverCommissionCoverage(
        justEnough.client as never,
        {
          driverUserId: "driver-1",
          currency: "DZD",
          commissionDue: 150,
          ...CASH,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("requires no prepaid balance for a fully collected flaminGO Pay ride", async () => {
    // المنصّة تُحصّل الأجرة وتحتجز العمولة منها ⇒ المحفظة لا تُمسّ.
    const h = buildService({ wallet: 0 });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 150,
        electronicallyCollected: 1000,
      }),
    ).resolves.toBeUndefined();
  });

  it("still requires the shortfall when a huge discount leaves too little collected", async () => {
    // خصم ضخم: الراكب دفع 80 فقط والعمولة 150 على الأجرة الكاملة ⇒ 70 مطلوبة.
    const h = buildService({ wallet: 69 });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 150,
        electronicallyCollected: 80,
      }),
    ).rejects.toMatchObject({
      code: "DRIVER_COMMISSION_BALANCE_INSUFFICIENT",
      details: { required: 70 },
    });
  });

  it("is a no-op when the configured commission is zero", async () => {
    const h = buildService({ wallet: 0 });
    await expect(
      h.service.assertDriverCommissionCoverage(h.client as never, {
        driverUserId: "driver-1",
        currency: "DZD",
        commissionDue: 0,
        ...CASH,
      }),
    ).resolves.toBeUndefined();
    // ولا يستعلم عن أي رصيد أصلًا.
    expect(h.lookups).toEqual([]);
  });

  it("reads the commission wallet and the coupon credit, and nothing else", async () => {
    const h = buildService({ wallet: 500, commissionCredit: 0 });
    await h.service.assertDriverCommissionCoverage(h.client as never, {
      driverUserId: "driver-7",
      currency: "DZD",
      commissionDue: 150,
      ...CASH,
    });
    expect(h.lookups.sort()).toEqual([
      "USER:driver-7:DZD:AVAILABLE",
      "USER:driver-7:DZD:COMMISSION_CREDIT",
    ]);
    // لا يقرأ PLATFORM:DRIVER_PAYABLE ولا DriverEarning: صافي الأرباح ليس
    // تغطية عمولة، وخلطهما هو الخطأ الذي يصححه هذا النموذج.
    expect(
      h.lookups.some((code) => code.includes("DRIVER_PAYABLE")),
    ).toBe(false);
  });

  it("is scoped per currency", async () => {
    const h = buildService({ wallet: 500 });
    await h.service.assertDriverCommissionCoverage(h.client as never, {
      driverUserId: "driver-1",
      currency: "EUR",
      commissionDue: 150,
      ...CASH,
    });
    expect(h.lookups).toContain("USER:driver-1:EUR:AVAILABLE");
  });
});
