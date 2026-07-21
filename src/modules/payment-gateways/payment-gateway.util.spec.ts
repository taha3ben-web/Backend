import {
  BASE_PROVIDERS,
  classifyWebhookHealth,
  computeFailureRatio,
  countWebhookProviders,
  isProtectionConfigured,
  normalizeSignatureScheme,
  parseProviderList,
  resolveGatewayProviders,
} from "./payment-gateway.util";

describe("payment-gateway.util", () => {
  describe("normalizeSignatureScheme", () => {
    it("الافتراضي hex", () => {
      expect(normalizeSignatureScheme(undefined)).toBe("hmac_sha256_hex");
      expect(normalizeSignatureScheme("weird")).toBe("hmac_sha256_hex");
    });
    it("base64 وألقابه", () => {
      expect(normalizeSignatureScheme("base64")).toBe("hmac_sha256_base64");
      expect(normalizeSignatureScheme("hmac_sha256_base64")).toBe("hmac_sha256_base64");
    });
    it("none", () => {
      expect(normalizeSignatureScheme("none")).toBe("none");
    });
  });

  describe("parseProviderList", () => {
    it("فارغ", () => {
      expect(parseProviderList(undefined)).toEqual([]);
    });
    it("تطبيع + إزالة تكرار", () => {
      expect(parseProviderList(" Stripe , stripe ,Adyen")).toEqual(["stripe", "adyen"]);
    });
  });

  describe("resolveGatewayProviders", () => {
    it("المزوّدون الأساسيون فقط حين لا بيئة", () => {
      const providers = resolveGatewayProviders({});
      expect(providers).toHaveLength(BASE_PROVIDERS.length);
      expect(providers.every((p) => p.enabled)).toBe(true);
    });

    it("cash/wallet داخليّان بلا webhook", () => {
      const providers = resolveGatewayProviders({});
      const cash = providers.find((p) => p.key === "cash");
      expect(cash?.webhookDriven).toBe(false);
      expect(cash?.signatureScheme).toBe("none");
    });

    it("يضيف مزوّدي بطاقات إضافيين دون تكرار الأساسيين", () => {
      const providers = resolveGatewayProviders({
        PAYMENT_PROVIDERS: "stripe",
        PAYMENT_WEBHOOK_SECRET: "s",
        PAYMENT_WEBHOOK_SCHEME: "base64",
      });
      expect(providers).toHaveLength(BASE_PROVIDERS.length + 1);
      const stripe = providers.find((p) => p.key === "stripe");
      expect(stripe?.webhookDriven).toBe(true);
      expect(stripe?.signatureScheme).toBe("hmac_sha256_base64");
      expect(stripe?.protectionConfigured).toBe(true);
    });
  });

  describe("protection + counts", () => {
    it("التوكن وحده يُعدّ حماية", () => {
      expect(isProtectionConfigured(resolveGatewayProviders({ PAYMENT_WEBHOOK_TOKEN: "t" }))).toBe(true);
    });
    it("لا حماية حين البيئة فارغة", () => {
      expect(isProtectionConfigured(resolveGatewayProviders({}))).toBe(false);
    });
    it("يعدّ مزوّدي الـ webhook", () => {
      expect(countWebhookProviders(resolveGatewayProviders({}))).toBe(0);
    });
  });

  describe("computeFailureRatio", () => {
    it("صفر عند إجمالي صفر", () => {
      expect(computeFailureRatio(0, 0)).toBe(0);
    });
    it("يقيّد في [0,1]", () => {
      expect(computeFailureRatio(20, 10)).toBe(1);
      expect(computeFailureRatio(5, 10)).toBe(0.5);
    });
  });

  describe("classifyWebhookHealth", () => {
    it("سليم", () => {
      const h = classifyWebhookHealth({
        totalEvents: 100,
        failedEvents: 2,
        lastEventAgeMs: 1_000,
        webhookProviders: 1,
        protectionConfigured: true,
      });
      expect(h.severity).toBe("healthy");
    });

    it("غير محمي → حرِج", () => {
      const h = classifyWebhookHealth({
        totalEvents: 0,
        failedEvents: 0,
        lastEventAgeMs: null,
        webhookProviders: 1,
        protectionConfigured: false,
      });
      expect(h.severity).toBe("critical");
      expect(h.unprotected).toBe(true);
    });

    it("تحذير عند نسبة فشل مرتفعة", () => {
      const h = classifyWebhookHealth({
        totalEvents: 50,
        failedEvents: 10,
        lastEventAgeMs: 1_000,
        webhookProviders: 1,
        protectionConfigured: true,
      });
      expect(h.severity).toBe("warning");
      expect(h.failureRatio).toBeCloseTo(0.2, 5);
    });

    it("حرِج عند نسبة فشل عالية مع عيّنة كافية", () => {
      const h = classifyWebhookHealth({
        totalEvents: 50,
        failedEvents: 30,
        lastEventAgeMs: 1_000,
        webhookProviders: 1,
        protectionConfigured: true,
      });
      expect(h.severity).toBe("critical");
    });

    it("عيّنة صغيرة لا ترفع لحرِج عبر النسبة", () => {
      const h = classifyWebhookHealth({
        totalEvents: 3,
        failedEvents: 3,
        lastEventAgeMs: 1_000,
        webhookProviders: 1,
        protectionConfigured: true,
      });
      expect(h.severity).not.toBe("critical");
    });

    it("راكد → تحذير", () => {
      const h = classifyWebhookHealth({
        totalEvents: 20,
        failedEvents: 0,
        lastEventAgeMs: 48 * 60 * 60 * 1_000,
        webhookProviders: 1,
        protectionConfigured: true,
      });
      expect(h.severity).toBe("warning");
      expect(h.stale).toBe(true);
    });

    it("لا مزوّدي webhook → سليم غير مكشوف", () => {
      const h = classifyWebhookHealth({
        totalEvents: 0,
        failedEvents: 0,
        lastEventAgeMs: null,
        webhookProviders: 0,
        protectionConfigured: false,
      });
      expect(h.severity).toBe("healthy");
      expect(h.unprotected).toBe(false);
      expect(h.recommendations.length).toBeGreaterThan(0);
    });
  });
});
