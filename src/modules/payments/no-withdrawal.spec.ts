import { WithdrawalsService } from "./withdrawals.service";
import { WithdrawalsController } from "./withdrawals.controller";
import { AppException } from "../../common/api/app.exception";
import { httpStatusForCode } from "../../common/api/api-error.util";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

  /**
   * مسارَان يطابقان كلمة "withdraw" نصًّا ولا علاقة لهما بالمال إطلاقًا،
   * فهما مستثنيان بسببٍ موثّق لا بتخفيف النمط:
   *
   *  • `fare-offers-driver.controller.ts` → `POST /:id/withdraw` يسحب السائق
   *    **عرض سعره** (يتراجع عن مزايدته). لا مبلغ ولا حساب.
   *  • `payouts.controller.ts` → `POST /from-withdrawals` مسار طاقم يبني
   *    دفعة صرف من طلبات سحب **قديمة معتمدة مسبقًا**. هذا بالضبط ما أبقيناه
   *    قصدًا كي تُنهي العمليات ما كان معلّقًا قبل التصحيح.
   */
  const ALLOWED_WITHDRAW_ROUTES = [
    'src/modules/fare-quotes/fare-offers-driver.controller.ts:@Post(":id/withdraw")',
    'src/modules/payouts/payouts.controller.ts:@Post("from-withdrawals")',
  ];

  it("has no cash-out creation route anywhere in the codebase (passenger included)", () => {
    // فحص على مستوى المصدر بدل الاعتماد على حارس واحد: لو أُضيف مسار سحب
    // في أي وحدة أخرى (راكب، سائق، وكيل) يفشل هذا الاختبار فورًا.
    const root = join(__dirname, "..", "..", "..");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".controller.ts")) out.push(full);
      }
      return out;
    };

    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = relative(root, file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*")) return;
        // مسار كتابة (POST/PUT) يحمل دلالة سحب/صرف نقدي.
        if (!/@(Post|Put)\(/.test(code)) return;
        if (!/withdraw|cash[-_]?out|payout-request/i.test(code)) return;
        if (ALLOWED_WITHDRAW_ROUTES.includes(`${rel}:${code}`)) return;
        offenders.push(`${rel}:${index + 1}: ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the documented exceptions honest (they must still exist)", () => {
    // لو حُذف أحد المسارَين المستثنيين أو تغيّر شكله، يجب تحديث القائمة
    // أعلاه بوعي بدل أن تصبح استثناءً ميتًا يُخفي مسارًا جديدًا.
    const root = join(__dirname, "..", "..", "..");
    for (const entry of ALLOWED_WITHDRAW_ROUTES) {
      const separator = entry.indexOf(":@");
      const file = entry.slice(0, separator);
      const decorator = entry.slice(separator + 1);
      expect(readFileSync(join(root, file), "utf8")).toContain(decorator);
    }
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
