import {
  TIP_MAX_AMOUNT,
  TIP_MIN_AMOUNT,
  isWithinTipWindow,
  tipIdempotencyKey,
  validateTipAmount,
} from "./tips.util";

describe("tips.util", () => {
  it("accepts amounts inside the allowed range", () => {
    expect(validateTipAmount(TIP_MIN_AMOUNT)).toBeNull();
    expect(validateTipAmount(100)).toBeNull();
    expect(validateTipAmount(TIP_MAX_AMOUNT)).toBeNull();
  });

  it("rejects out-of-range and invalid amounts", () => {
    expect(validateTipAmount(TIP_MIN_AMOUNT - 1)).toBe("AMOUNT_TOO_SMALL");
    expect(validateTipAmount(TIP_MAX_AMOUNT + 1)).toBe("AMOUNT_TOO_LARGE");
    expect(validateTipAmount(0)).toBe("AMOUNT_INVALID");
    expect(validateTipAmount(-50)).toBe("AMOUNT_INVALID");
    expect(validateTipAmount(Number.NaN)).toBe("AMOUNT_INVALID");
    expect(validateTipAmount(Number.POSITIVE_INFINITY)).toBe("AMOUNT_INVALID");
  });

  it("keeps the tip window open for 72 hours after completion", () => {
    const completedAt = new Date("2026-07-27T00:00:00.000Z");
    expect(
      isWithinTipWindow(completedAt, new Date("2026-07-27T01:00:00.000Z")),
    ).toBe(true);
    expect(
      isWithinTipWindow(completedAt, new Date("2026-07-29T23:59:00.000Z")),
    ).toBe(true);
    expect(
      isWithinTipWindow(completedAt, new Date("2026-07-30T00:01:00.000Z")),
    ).toBe(false);
  });

  it("refuses tips for trips that never completed", () => {
    expect(isWithinTipWindow(null)).toBe(false);
    expect(isWithinTipWindow(undefined)).toBe(false);
  });

  it("builds one idempotency key per trip", () => {
    expect(tipIdempotencyKey("abc")).toBe("trip:tip:abc");
    expect(tipIdempotencyKey("abc")).toBe(tipIdempotencyKey("abc"));
    expect(tipIdempotencyKey("abc")).not.toBe(tipIdempotencyKey("abd"));
  });
});
