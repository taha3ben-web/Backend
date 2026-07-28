import {
  decryptField,
  encryptField,
  isEncrypted,
  isFieldEncryptionEnabled,
} from "./field-crypto";

describe("field-crypto", () => {
  const KEY = "unit-test-secret-key";

  describe("with encryption key configured", () => {
    beforeEach(() => {
      process.env.FIELD_ENCRYPTION_KEY = KEY;
    });
    afterEach(() => {
      delete process.env.FIELD_ENCRYPTION_KEY;
    });

    it("round-trips a value", () => {
      const enc = encryptField("DZ1234567890");
      expect(enc).not.toBeNull();
      expect(isEncrypted(enc as string)).toBe(true);
      expect(enc).not.toBe("DZ1234567890");
      expect(decryptField(enc)).toBe("DZ1234567890");
    });

    it("uses a random IV so ciphertext differs each call", () => {
      expect(encryptField("same-value")).not.toBe(encryptField("same-value"));
    });

    it("is idempotent on already-encrypted input", () => {
      const once = encryptField("secret") as string;
      expect(encryptField(once)).toBe(once);
    });

    it("passes through legacy plaintext on decrypt", () => {
      expect(decryptField("legacy-plain-iban")).toBe("legacy-plain-iban");
    });

    it("handles null, undefined and empty string", () => {
      expect(encryptField(null)).toBeNull();
      expect(encryptField(undefined)).toBeNull();
      expect(encryptField("")).toBe("");
      expect(decryptField(null)).toBeNull();
      expect(decryptField(undefined)).toBeNull();
    });

    it("reports enabled", () => {
      expect(isFieldEncryptionEnabled()).toBe(true);
    });
  });

  describe("without encryption key", () => {
    beforeEach(() => {
      delete process.env.FIELD_ENCRYPTION_KEY;
    });

    it("is disabled and passes values through unchanged", () => {
      expect(isFieldEncryptionEnabled()).toBe(false);
      expect(encryptField("plain")).toBe("plain");
      expect(decryptField("plain")).toBe("plain");
    });
  });
});
