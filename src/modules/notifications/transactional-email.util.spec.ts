import {
  formatEmailAmount,
  isSendableEmail,
  lostItemStatusLabel,
  recipientLocale,
  recipientName,
} from "./transactional-email.util";

describe("isSendableEmail", () => {
  it("accepts a normal address", () => {
    expect(isSendableEmail("rider@example.test")).toBe(true);
  });

  it("refuses empty, null and whitespace values", () => {
    expect(isSendableEmail(undefined)).toBe(false);
    expect(isSendableEmail(null)).toBe(false);
    expect(isSendableEmail("")).toBe(false);
    expect(isSendableEmail("rider @example.test")).toBe(false);
  });

  it("refuses malformed addresses instead of calling the provider", () => {
    expect(isSendableEmail("rider")).toBe(false);
    expect(isSendableEmail("rider@localhost")).toBe(false);
    expect(isSendableEmail("a@b@c.test")).toBe(false);
  });

  it("refuses an absurdly long address", () => {
    expect(isSendableEmail(`${"a".repeat(250)}@example.test`)).toBe(false);
  });
});

describe("recipientLocale", () => {
  it("passes through the supported locales", () => {
    expect(recipientLocale("ar")).toBe("ar");
    expect(recipientLocale("fr")).toBe("fr");
    expect(recipientLocale("en")).toBe("en");
  });

  it("falls back to Arabic for unknown or missing locales", () => {
    expect(recipientLocale(null)).toBe("ar");
    expect(recipientLocale(undefined)).toBe("ar");
    expect(recipientLocale("de")).toBe("ar");
  });
});

describe("recipientName", () => {
  it("uses the stored name when present", () => {
    expect(recipientName("  Taha  ", "ar")).toBe("Taha");
  });

  it("uses a localized fallback when the name is missing", () => {
    expect(recipientName(null, "fr")).toBe("Cher client");
    expect(recipientName("", "en")).toBe("Dear customer");
    expect(recipientName("   ", "ar")).not.toHaveLength(0);
  });
});

describe("formatEmailAmount", () => {
  it("always shows two decimals", () => {
    expect(formatEmailAmount(700)).toBe("700.00");
    expect(formatEmailAmount("1234.5")).toBe("1234.50");
  });

  it("treats missing or broken values as zero instead of printing NaN", () => {
    expect(formatEmailAmount(null)).toBe("0.00");
    expect(formatEmailAmount(undefined)).toBe("0.00");
    expect(formatEmailAmount("abc")).toBe("0.00");
  });

  it("accepts a Decimal-like object via its string form", () => {
    expect(formatEmailAmount({ toString: () => "42.1" })).toBe("42.10");
  });
});

describe("lostItemStatusLabel", () => {
  it("translates each status per locale", () => {
    expect(lostItemStatusLabel("RETURNED", "fr")).toBe("Objet restitué");
    expect(lostItemStatusLabel("NOT_FOUND", "en")).toBe("Item not found");
    expect(lostItemStatusLabel("DRIVER_NOTIFIED", "ar")).toContain("السائق");
  });

  it("never leaks a raw enum when a label exists", () => {
    for (const status of [
      "REPORTED",
      "DRIVER_NOTIFIED",
      "FOUND",
      "RETURNED",
      "NOT_FOUND",
      "CLOSED",
    ]) {
      expect(lostItemStatusLabel(status, "ar")).not.toBe(status);
    }
  });

  it("returns the raw value for an unknown status instead of throwing", () => {
    expect(lostItemStatusLabel("SOMETHING_NEW", "ar")).toBe("SOMETHING_NEW");
  });
});
