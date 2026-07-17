import {
  DEFAULT_COUNTRY_CONFIGS,
  computeTax,
  isValidCountryCode,
  normalizeCountryCode,
  normalizePhoneE164,
  resolveCountryConfig,
} from "./country-config.util";

describe("country-config.util", () => {
  describe("normalizeCountryCode / isValidCountryCode", () => {
    it("uppercases and trims", () => {
      expect(normalizeCountryCode(" dz ")).toBe("DZ");
    });
    it("validates alpha-2", () => {
      expect(isValidCountryCode("dz")).toBe(true);
      expect(isValidCountryCode("DZA")).toBe(false);
      expect(isValidCountryCode("1D")).toBe(false);
    });
  });

  describe("resolveCountryConfig", () => {
    it("resolves a known country", () => {
      expect(resolveCountryConfig("dz")?.currency).toBe("DZD");
    });
    it("returns null for unknown without fallback", () => {
      expect(resolveCountryConfig("ZZ")).toBeNull();
    });
    it("uses fallback when provided", () => {
      expect(resolveCountryConfig("ZZ", DEFAULT_COUNTRY_CONFIGS as any, "DZ")?.code).toBe(
        "DZ",
      );
    });
  });

  describe("normalizePhoneE164", () => {
    const dz = { dialCode: "213", nationalNumberLength: 9 };

    it("normalizes a local number with leading zero", () => {
      expect(normalizePhoneE164("0551234567", dz)).toBe("+213551234567");
    });
    it("normalizes a number already in +CC form", () => {
      expect(normalizePhoneE164("+213 551 23 45 67", dz)).toBe("+213551234567");
    });
    it("normalizes a 00 international prefix", () => {
      expect(normalizePhoneE164("00213551234567", dz)).toBe("+213551234567");
    });
    it("strips separators and parentheses", () => {
      expect(normalizePhoneE164("(0551)-23-45-67", dz)).toBe("+213551234567");
    });
    it("rejects wrong length", () => {
      expect(normalizePhoneE164("12345", dz)).toBeNull();
    });
    it("rejects non-numeric", () => {
      expect(normalizePhoneE164("055ABC1234", dz)).toBeNull();
    });
    it("rejects empty", () => {
      expect(normalizePhoneE164("", dz)).toBeNull();
    });
  });

  describe("computeTax", () => {
    it("EXCLUSIVE adds tax on top", () => {
      const r = computeTax(100, 19, "EXCLUSIVE");
      expect(r.net).toBe(100);
      expect(r.tax).toBe(19);
      expect(r.gross).toBe(119);
    });
    it("INCLUSIVE extracts embedded tax and conserves gross", () => {
      const r = computeTax(119, 19, "INCLUSIVE");
      expect(r.gross).toBe(119);
      expect(r.tax).toBe(19);
      expect(r.net).toBe(100);
      // ثابت: net + tax = gross
      expect(round(r.net + r.tax)).toBe(r.gross);
    });
    it("zero rate is a no-op", () => {
      const r = computeTax(50, 0, "EXCLUSIVE");
      expect(r).toEqual({ net: 50, tax: 0, gross: 50 });
    });
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
