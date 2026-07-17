import {
  canTransition,
  isTerminal,
  isValidIban,
  buildBatchTotals,
  normalizeProviderStatus,
  gatewayCapabilities,
  buildBatchReference,
} from "./payout.util";

describe("payout.util", () => {
  describe("status machine", () => {
    it("allows valid transitions", () => {
      expect(canTransition("DRAFT", "SUBMITTED")).toBe(true);
      expect(canTransition("PROCESSING", "PAID")).toBe(true);
      expect(canTransition("FAILED", "SUBMITTED")).toBe(true);
    });
    it("blocks invalid transitions", () => {
      expect(canTransition("PAID", "PROCESSING")).toBe(false);
      expect(canTransition("DRAFT", "PAID")).toBe(false);
    });
    it("knows terminal states", () => {
      expect(isTerminal("PAID")).toBe(true);
      expect(isTerminal("CANCELED")).toBe(true);
      expect(isTerminal("PROCESSING")).toBe(false);
    });
  });

  describe("IBAN", () => {
    it("accepts plausible IBANs", () => {
      expect(isValidIban("DZ58 0002 1000 0011 1000 0570 25")).toBe(true);
    });
    it("rejects malformed", () => {
      expect(isValidIban("12")).toBe(false);
      expect(isValidIban("!!bad!!")).toBe(false);
    });
  });

  describe("buildBatchTotals", () => {
    it("sums minor units", () => {
      const t = buildBatchTotals([
        { amountMinor: 1500, currency: "DZD" },
        { amountMinor: 2500, currency: "DZD" },
      ]);
      expect(t).toEqual({ count: 2, totalMinor: 4000, currency: "DZD" });
    });
    it("rejects mixed currency", () => {
      expect(() =>
        buildBatchTotals([
          { amountMinor: 100, currency: "DZD" },
          { amountMinor: 100, currency: "USD" },
        ]),
      ).toThrow("MIXED_CURRENCY");
    });
    it("rejects empty and non-integer", () => {
      expect(() => buildBatchTotals([])).toThrow("EMPTY_BATCH");
      expect(() =>
        buildBatchTotals([{ amountMinor: 1.5, currency: "DZD" }]),
      ).toThrow("INVALID_AMOUNT");
    });
  });

  it("normalizes provider statuses", () => {
    expect(normalizeProviderStatus("completed")).toBe("PAID");
    expect(normalizeProviderStatus("rejected")).toBe("FAILED");
    expect(normalizeProviderStatus("pending")).toBe("PROCESSING");
    expect(normalizeProviderStatus("weird")).toBe("PROCESSING");
  });

  it("exposes gateway capabilities", () => {
    expect(gatewayCapabilities("stripe").payout).toBe(true);
    expect(gatewayCapabilities("chargily").refund).toBe(false);
    expect(gatewayCapabilities("unknown").webhookVerified).toBe(false);
  });

  it("builds deterministic batch references", () => {
    expect(buildBatchReference("stripe", "20260714", 7)).toBe(
      "PO-STRIPE-20260714-0007",
    );
  });
});
