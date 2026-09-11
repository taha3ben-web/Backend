import { WalletTopUpsService } from "./wallet-topups.service";
import { PaymentProviderService } from "./payment-provider.service";
import { AppException } from "../../common/api/app.exception";
import type { PaymentAdapter } from "./providers/payment-adapter";

/**
 * شحن المحفظة — الراكب (flaminGO Pay) والسائق (محفظة العمولة).
 *
 * نفس المسار ونفس القيد لكلا الطرفين، لأن الحساب المحاسبي واحد
 * (`USER:<id>:<CUR>:AVAILABLE`) ويختلف معناه التجاري بنوع المستخدم.
 * الاختبارات تُثبت الخمول على الطبقات الثلاث: الطلب، الـwebhook، والقيد.
 */

interface Row {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  method: string;
  provider: string;
  providerPaymentId: string | null;
  providerStatus: string | null;
  status: "PENDING" | "CAPTURED" | "FAILED" | "CANCELED";
  statusReason: string | null;
  reference: string | null;
  idempotencyKey: string;
  capturedAt: Date | null;
}

function buildHarness() {
  const topUps: Row[] = [];
  const events: Array<{ topUpId: string; idempotencyKey?: string | null }> = [];
  /** يحاكي LedgerTransaction.idempotencyKey @unique — الحارس الأخير. */
  const ledgerKeys = new Set<string>();
  const credits: Array<{ userId: string; amount: number }> = [];
  let seq = 0;

  const prisma = {
    walletTopUp: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, string> }) =>
        topUps.find(
          (t) =>
            (where.id !== undefined && t.id === where.id) ||
            (where.idempotencyKey !== undefined &&
              t.idempotencyKey === where.idempotencyKey),
        ) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, string> }) =>
          topUps.find(
            (t) =>
              t.provider === where.provider &&
              t.providerPaymentId === where.providerPaymentId,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: `topup-${++seq}`,
          userId: data.userId as string,
          amount: Number(data.amount),
          currency: data.currency as string,
          method: data.method as string,
          provider: data.provider as string,
          providerPaymentId: null,
          providerStatus: null,
          status: "PENDING",
          statusReason: null,
          reference: (data.reference as string) ?? null,
          idempotencyKey: data.idempotencyKey as string,
          capturedAt: null,
        };
        topUps.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = topUps.find((t) => t.id === where.id);
          if (!row) throw new Error("not found");
          if (data.status) row.status = data.status as Row["status"];
          if (data.providerPaymentId !== undefined) {
            row.providerPaymentId = data.providerPaymentId as string;
          }
          if (data.providerStatus !== undefined) {
            row.providerStatus = (data.providerStatus as string) ?? null;
          }
          if (data.capturedAt) row.capturedAt = data.capturedAt as Date;
          return row;
        },
      ),
    },
    walletTopUpEvent: {
      findUnique: jest.fn(
        async ({ where }: { where: { idempotencyKey: string } }) =>
          events.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push({
          topUpId: data.topUpId as string,
          idempotencyKey: (data.idempotencyKey as string) ?? null,
        });
        return data;
      }),
    },
  };

  const financial = {
    creditWalletTopUp: jest.fn(
      async (input: { topUpId: string; userId: string; amount: number }) => {
        const key = `wallet:topup:${input.topUpId}`;
        if (ledgerKeys.has(key)) return; // idempotent في الدفتر
        ledgerKeys.add(key);
        credits.push({ userId: input.userId, amount: input.amount });
      },
    ),
  };

  const cardAdapter: PaymentAdapter = {
    name: "testgateway",
    redirectBased: true,
    createCheckout: async (input) => ({
      provider: "testgateway",
      providerPaymentId: `gw_${input.paymentId}`,
      providerStatus: "created",
      checkoutUrl: "https://gateway.test/pay",
      payload: {},
    }),
    capture: async () => ({
      provider: "testgateway",
      providerStatus: "paid",
      payload: {},
    }),
    refund: async () => ({
      provider: "testgateway",
      providerStatus: "refunded",
      payload: {},
    }),
    cancel: async () => ({
      provider: "testgateway",
      providerStatus: "canceled",
      payload: {},
    }),
  };
  const provider = new PaymentProviderService();
  provider.register(cardAdapter);

  const settings = { getValue: jest.fn(async () => null) };

  const service = new WalletTopUpsService(
    prisma as never,
    financial as never,
    provider,
    settings as never,
  );
  return { service, prisma, financial, credits, topUps, events, settings };
}

describe("wallet top-up", () => {
  it("passenger top-up creates one top-up and a provider checkout", async () => {
    const h = buildHarness();
    const result = await h.service.create("passenger-1", {
      amount: 2000,
      method: "CARD",
      idempotencyKey: "req-1",
    });
    expect(result.reused).toBe(false);
    expect(result.checkout?.checkoutUrl).toBe("https://gateway.test/pay");
    expect(h.topUps).toHaveLength(1);
    expect(h.topUps[0].status).toBe("PENDING");
    // لا رصيد قبل تأكيد المزوّد.
    expect(h.credits).toEqual([]);
  });

  it("driver wallet top-up uses the exact same path and account", async () => {
    const h = buildHarness();
    await h.service.create("driver-1", {
      amount: 500,
      method: "CARD",
      idempotencyKey: "req-d",
    });
    await h.service.capture(h.topUps[0].id);
    expect(h.credits).toEqual([{ userId: "driver-1", amount: 500 }]);
  });

  it("repeating the request with the same idempotency key reuses the top-up", async () => {
    const h = buildHarness();
    await h.service.create("passenger-1", { amount: 1000, idempotencyKey: "k" });
    const again = await h.service.create("passenger-1", {
      amount: 1000,
      idempotencyKey: "k",
    });
    expect(again.reused).toBe(true);
    expect(h.topUps).toHaveLength(1);
  });

  it("refuses to reuse another user's idempotency key", async () => {
    const h = buildHarness();
    await h.service.create("passenger-1", { amount: 1000, idempotencyKey: "k" });
    await expect(
      h.service.create("passenger-2", { amount: 1000, idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("credits the balance exactly once on capture", async () => {
    const h = buildHarness();
    await h.service.create("passenger-1", { amount: 1500, idempotencyKey: "k" });
    const id = h.topUps[0].id;
    await h.service.capture(id);
    await h.service.capture(id); // idempotent
    expect(h.credits).toEqual([{ userId: "passenger-1", amount: 1500 }]);
    expect(h.topUps[0].status).toBe("CAPTURED");
  });

  it("does NOT double-credit when the provider re-delivers the same webhook", async () => {
    const h = buildHarness();
    await h.service.create("passenger-1", { amount: 1200, idempotencyKey: "k" });
    const providerPaymentId = h.topUps[0].providerPaymentId as string;
    const payload = {
      id: providerPaymentId,
      type: "checkout.paid",
      eventId: "evt-1",
    };

    const first = await h.service.processWebhook("testgateway", payload, "evt-1");
    const second = await h.service.processWebhook("testgateway", payload, "evt-1");
    const third = await h.service.processWebhook("testgateway", payload, "evt-1");

    expect(first).toMatchObject({ matched: true, credited: true });
    expect(second).toMatchObject({ matched: true, duplicate: true });
    expect(third).toMatchObject({ matched: true, duplicate: true });
    expect(h.credits).toEqual([{ userId: "passenger-1", amount: 1200 }]);
  });

  it("does not credit on a failed provider event", async () => {
    const h = buildHarness();
    await h.service.create("passenger-1", { amount: 900, idempotencyKey: "k" });
    const providerPaymentId = h.topUps[0].providerPaymentId as string;
    const result = await h.service.processWebhook(
      "testgateway",
      { id: providerPaymentId, type: "checkout.failed" },
      "evt-fail",
    );
    expect(result).toMatchObject({ matched: true, credited: false });
    expect(h.topUps[0].status).toBe("FAILED");
    expect(h.credits).toEqual([]);
  });

  it("reports matched:false for an event that is not a top-up (routed to trip payments)", async () => {
    const h = buildHarness();
    const result = await h.service.processWebhook(
      "testgateway",
      { id: "some-trip-payment", type: "checkout.paid" },
      "evt-x",
    );
    expect(result).toEqual({ matched: false });
  });

  it("rejects a non-positive amount", async () => {
    const h = buildHarness();
    await expect(
      h.service.create("passenger-1", { amount: 0 }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("enforces Dashboard-configured min/max amounts", async () => {
    const h = buildHarness();
    h.settings.getValue.mockResolvedValue({
      minAmount: 100,
      maxAmount: 50000,
    } as never);
    await expect(
      h.service.create("passenger-1", { amount: 50 }),
    ).rejects.toMatchObject({ code: "WALLET_TOPUP_AMOUNT_INVALID" });
    await expect(
      h.service.create("passenger-1", { amount: 60000 }),
    ).rejects.toMatchObject({ code: "WALLET_TOPUP_AMOUNT_INVALID" });
    await expect(
      h.service.create("passenger-1", { amount: 1000, idempotencyKey: "ok" }),
    ).resolves.toMatchObject({ reused: false });
  });
});

describe("payment method vs payment provider are separable", () => {
  it("resolves any registered gateway for CARD — no provider is hard-coded", () => {
    const provider = new PaymentProviderService();
    expect(provider.resolveProvider("CASH")).toBe("cash");
    expect(provider.resolveProvider("WALLET")).toBe("wallet");
    // بلا بوابة مُسجّلة: خطأ صريح لا نجاح وهمي.
    expect(() => provider.resolveProvider("CARD")).toThrow(
      /No card payment provider is configured/,
    );

    const visa: PaymentAdapter = {
      name: "visa_provider",
      redirectBased: true,
      createCheckout: async () => ({
        provider: "visa_provider",
        providerPaymentId: "v1",
        providerStatus: "created",
        checkoutUrl: null,
        payload: {},
      }),
      capture: async () => ({
        provider: "visa_provider",
        providerStatus: "paid",
        payload: {},
      }),
      refund: async () => ({
        provider: "visa_provider",
        providerStatus: "refunded",
        payload: {},
      }),
      cancel: async () => ({
        provider: "visa_provider",
        providerStatus: "canceled",
        payload: {},
      }),
    };
    provider.register(visa);
    // بوابة جديدة = ملف + register، بلا تعديل منطق الدفع أو المحفظة.
    expect(provider.resolveProvider("CARD")).toBe("visa_provider");
    // ويمكن دائمًا فرض بوابة صراحةً.
    expect(provider.resolveProvider("CARD", "Chargily")).toBe("chargily");
    expect(provider.enabledProviders).toContain("visa_provider");
  });
});
