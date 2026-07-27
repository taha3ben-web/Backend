import { createHmac } from "node:crypto";
import {
  CHARGILY_LIVE_BASE_URL,
  CHARGILY_TEST_BASE_URL,
  ChargilyPaymentAdapter,
  mapChargilyStatus,
  readChargilyConfig,
  verifyChargilySignature,
} from "./chargily.adapter";

describe("chargily config", () => {
  it("returns null when the secret key is missing", () => {
    expect(readChargilyConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("defaults to the test base url and edahabia", () => {
    const config = readChargilyConfig({
      CHARGILY_SECRET_KEY: "sk_test_x",
    } as NodeJS.ProcessEnv);
    expect(config?.baseUrl).toBe(CHARGILY_TEST_BASE_URL);
    expect(config?.defaultMethod).toBe("edahabia");
    expect(config?.locale).toBe("ar");
  });

  it("switches to live mode and cib on request", () => {
    const config = readChargilyConfig({
      CHARGILY_SECRET_KEY: "sk_live_x",
      CHARGILY_MODE: "live",
      CHARGILY_DEFAULT_METHOD: "CIB",
    } as NodeJS.ProcessEnv);
    expect(config?.baseUrl).toBe(CHARGILY_LIVE_BASE_URL);
    expect(config?.defaultMethod).toBe("cib");
  });

  it("strips trailing slashes from an explicit base url", () => {
    const config = readChargilyConfig({
      CHARGILY_SECRET_KEY: "sk",
      CHARGILY_BASE_URL: "https://example.test/api/v2///",
    } as NodeJS.ProcessEnv);
    expect(config?.baseUrl).toBe("https://example.test/api/v2");
  });
});

describe("chargily webhook signature", () => {
  const secretKey = "sk_test_secret";
  const rawBody = Buffer.from(
    JSON.stringify({ id: "evt_1", type: "checkout.paid" }),
    "utf8",
  );

  it("accepts a signature computed over the raw bytes", () => {
    const signature = createHmac("sha256", secretKey)
      .update(rawBody)
      .digest("hex");
    expect(verifyChargilySignature({ secretKey, rawBody, signature })).toBe(
      true,
    );
  });

  it("rejects a signature from a different secret", () => {
    const signature = createHmac("sha256", "other")
      .update(rawBody)
      .digest("hex");
    expect(verifyChargilySignature({ secretKey, rawBody, signature })).toBe(
      false,
    );
  });

  it("rejects a missing or malformed signature", () => {
    expect(verifyChargilySignature({ secretKey, rawBody })).toBe(false);
    expect(
      verifyChargilySignature({ secretKey, rawBody, signature: "not-hex" }),
    ).toBe(false);
  });

  it("rejects an empty body instead of trusting it", () => {
    const empty = Buffer.alloc(0);
    const signature = createHmac("sha256", secretKey)
      .update(empty)
      .digest("hex");
    expect(
      verifyChargilySignature({ secretKey, rawBody: empty, signature }),
    ).toBe(false);
  });
});

describe("chargily status mapping", () => {
  it("maps event names and plain statuses alike", () => {
    expect(mapChargilyStatus("checkout.paid")).toBe("CAPTURED");
    expect(mapChargilyStatus("paid")).toBe("CAPTURED");
    expect(mapChargilyStatus("checkout.failed")).toBe("FAILED");
    expect(mapChargilyStatus("expired")).toBe("CANCELED");
    expect(mapChargilyStatus("processing")).toBe("PENDING");
  });

  it("returns undefined for unknown values", () => {
    expect(mapChargilyStatus("whatever")).toBeUndefined();
    expect(mapChargilyStatus(undefined)).toBeUndefined();
  });
});

describe("chargily adapter guards", () => {
  const adapter = new ChargilyPaymentAdapter({
    secretKey: "sk",
    baseUrl: CHARGILY_TEST_BASE_URL,
    defaultMethod: "edahabia",
    locale: "ar",
  });

  it("refuses currencies other than DZD before any network call", async () => {
    await expect(
      adapter.createCheckout({
        paymentId: "p1",
        tripId: "t1",
        method: "CARD",
        amount: 500,
        currency: "EUR",
      }),
    ).rejects.toThrow("CHARGILY_CURRENCY_UNSUPPORTED");
  });

  it("refuses non positive amounts", async () => {
    await expect(
      adapter.createCheckout({
        paymentId: "p1",
        tripId: "t1",
        method: "CARD",
        amount: 0,
        currency: "DZD",
      }),
    ).rejects.toThrow("CHARGILY_INVALID_AMOUNT");
  });

  it("rejects refunds explicitly instead of faking success", async () => {
    await expect(
      adapter.refund({
        paymentId: "p1",
        provider: "chargily",
        amount: 500,
        currency: "DZD",
      }),
    ).rejects.toThrow("CHARGILY_REFUND_NOT_SUPPORTED");
  });
});
