import { WithdrawalsService } from "./withdrawals.service";
import { WithdrawalsController } from "./withdrawals.controller";
import { AppException } from "../../common/api/app.exception";
import { httpStatusForCode } from "../../common/api/api-error.util";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";

/**
 * لا سحب ولا صرف نقدي في نموذج عمل flaminGO.
 *
 * ثلاثة أرصدة، ولا واحد منها قابل للسحب:
 *   • flaminGO Pay للراكب — رصيد دفع مخزَّن.
 *   • محفظة عمولة السائق — رصيد تشغيلي مسبق الدفع، ليس ربحًا.
 *   • أرباح السائق الصافية — قيمة محاسبية؛ في النقد استلمها نقدًا، وفي
 *     flaminGO Pay هي مستحقّ يُسوّى تشغيليًا خارج التطبيق.
 *
 * الاختبار يثبت أمرين: أن الخدمة ترفض الإنشاء بكود نطاق واضح، وأن المسار
 * `POST /withdrawals` لم يبقَ له وجود في المُتحكّم (لا اعتماد على الحراس).
 */
describe("withdrawals are not part of the business model", () => {
  const service = new WithdrawalsService(
    {} as never,
    {} as never,
    undefined,
    undefined,
  );

  it("rejects creating a driver withdrawal with WITHDRAWAL_NOT_SUPPORTED (403)", async () => {
    await expect(service.createForDriver("driver-user", 850)).rejects.toThrow(
      AppException,
    );
    const error = await service
      .createForDriver("driver-user", 850)
      .catch((e: unknown) => e as AppException);
    expect(error.code).toBe("WITHDRAWAL_NOT_SUPPORTED");
    expect(httpStatusForCode("WITHDRAWAL_NOT_SUPPORTED")).toBe(403);
  });

  it("rejects any amount, including one backed by real earnings", async () => {
    for (const amount of [1, 850, 100000]) {
      await expect(
        service.createForDriver("driver-user", amount),
      ).rejects.toMatchObject({ code: "WITHDRAWAL_NOT_SUPPORTED" });
    }
  });

  it("exposes no POST route on the withdrawals controller", () => {
    const proto = WithdrawalsController.prototype as unknown as Record<
      string,
      object
    >;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== "constructor",
    );
    const routes = handlers.map((name) => ({
      name,
      path: Reflect.getMetadata(PATH_METADATA, proto[name]) as string,
      method: Reflect.getMetadata(METHOD_METADATA, proto[name]) as number,
    }));
    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes.filter((r) => r.method === RequestMethod.POST),
    ).toEqual([]);
    // ولا حتى دالة اسمها create باقية.
    expect(handlers).not.toContain("create");
  });

  it("keeps staff review routes so pending legacy records can be closed", () => {
    const proto = WithdrawalsController.prototype as unknown as Record<
      string,
      object
    >;
    const handlers = Object.getOwnPropertyNames(proto);
    // لا نحذف بيانات ولا وظائف إدارية غير ذات صلة.
    expect(handlers).toContain("approve");
    expect(handlers).toContain("reject");
    expect(handlers).toContain("markPaid");
    expect(handlers).toContain("payoutIntegrity");
  });
});
