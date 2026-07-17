import {
  buildErrorEnvelope,
  codeForHttpStatus,
  httpStatusForCode,
  resolveLocale,
  translateCode,
} from "./api-error.util";

describe("api-error.util", () => {
  describe("resolveLocale", () => {
    it("defaults to ar when header absent", () => {
      expect(resolveLocale(undefined)).toBe("ar");
      expect(resolveLocale("")).toBe("ar");
    });
    it("picks the first supported tag", () => {
      expect(resolveLocale("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
      expect(resolveLocale("en-US,en;q=0.9")).toBe("en");
    });
    it("skips unsupported and falls back", () => {
      expect(resolveLocale("de-DE,de;q=0.9")).toBe("ar");
      expect(resolveLocale("de,en")).toBe("en");
    });
  });

  describe("httpStatusForCode / codeForHttpStatus", () => {
    it("maps codes to status", () => {
      expect(httpStatusForCode("NOT_FOUND")).toBe(404);
      expect(httpStatusForCode("RATE_LIMITED")).toBe(429);
      expect(httpStatusForCode("ACTIVE_TRIP_EXISTS")).toBe(409);
      expect(httpStatusForCode("CITY_CAPACITY_REJECTED")).toBe(503);
      expect(httpStatusForCode("INVALID_CREDENTIALS")).toBe(401);
      expect(httpStatusForCode("INVALID_WITHDRAWAL_TRANSITION")).toBe(409);
    });
    it("maps status back to a code", () => {
      expect(codeForHttpStatus(404)).toBe("NOT_FOUND");
      expect(codeForHttpStatus(401)).toBe("UNAUTHORIZED");
      expect(codeForHttpStatus(503)).toBe("INTERNAL");
      expect(codeForHttpStatus(418)).toBe("VALIDATION_ERROR");
    });
  });

  describe("translateCode", () => {
    it("translates per locale", () => {
      expect(translateCode("NOT_FOUND", "en")).toMatch(/not found/i);
      expect(translateCode("NOT_FOUND", "fr")).toMatch(/introuvable/i);
      expect(translateCode("NOT_FOUND", "ar")).toContain("غير موجود");
      expect(translateCode("TRIP_NOT_FOUND", "en")).toMatch(/trip/i);
      expect(translateCode("WITHDRAWAL_NOT_FOUND", "fr")).toMatch(/retrait/i);
      expect(translateCode("INVALID_PHONE_NUMBER", "ar")).toContain("الهاتف");
      expect(translateCode("INVALID_WITHDRAWAL_TRANSITION", "en")).toMatch(
        /transition/i,
      );
    });
  });

  describe("buildErrorEnvelope", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");

    it("builds a translated envelope", () => {
      const env = buildErrorEnvelope({
        code: "FORBIDDEN",
        locale: "en",
        path: "/api/x",
        requestId: "req-1",
        now,
      });
      expect(env.success).toBe(false);
      expect(env.error.code).toBe("FORBIDDEN");
      expect(env.error.message).toMatch(/permission/i);
      expect(env.statusCode).toBe(403);
      expect(env.requestId).toBe("req-1");
      expect(env.timestamp).toBe("2026-07-14T00:00:00.000Z");
    });

    it("honors a message override and details", () => {
      const env = buildErrorEnvelope({
        code: "VALIDATION_ERROR",
        locale: "ar",
        messageOverride: "custom",
        details: ["field x required"],
        now,
      });
      expect(env.error.message).toBe("custom");
      expect(env.error.details).toEqual(["field x required"]);
    });

    it("omits details when not provided", () => {
      const env = buildErrorEnvelope({ code: "INTERNAL", locale: "ar", now });
      expect("details" in env.error).toBe(false);
    });
  });
});
