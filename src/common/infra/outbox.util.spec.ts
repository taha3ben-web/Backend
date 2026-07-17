import {
  computeBackoffMs,
  nextOutboxState,
  OUTBOX_BASE_DELAY_MS,
  OUTBOX_MAX_DELAY_MS,
} from "./outbox.util";

describe("outbox retry policy", () => {
  it("computes exponential backoff and caps at the maximum", () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(1)).toBe(OUTBOX_BASE_DELAY_MS);
    expect(computeBackoffMs(2)).toBe(OUTBOX_BASE_DELAY_MS * 2);
    expect(computeBackoffMs(3)).toBe(OUTBOX_BASE_DELAY_MS * 4);
    // يجب ألا يتجاوز السقف مهما زادت المحاولات.
    expect(computeBackoffMs(50)).toBe(OUTBOX_MAX_DELAY_MS);
  });

  it("marks a successful delivery as DELIVERED", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = nextOutboxState({ success: true, attempts: 0, now });
    expect(t.status).toBe("DELIVERED");
    expect(t.attempts).toBe(1);
    expect(t.deliveredAt).toEqual(now);
    expect(t.lastError).toBeNull();
  });

  it("reschedules a failure as FAILED with a future availableAt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = nextOutboxState({
      success: false,
      attempts: 0,
      error: "boom",
      now,
    });
    expect(t.status).toBe("FAILED");
    expect(t.attempts).toBe(1);
    expect(t.lastError).toBe("boom");
    expect(t.availableAt.getTime()).toBe(now.getTime() + OUTBOX_BASE_DELAY_MS);
  });

  it("moves to DEAD (DLQ) once maxAttempts is reached", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = nextOutboxState({
      success: false,
      attempts: 2,
      maxAttempts: 3,
      error: "still failing",
      now,
    });
    expect(t.status).toBe("DEAD");
    expect(t.attempts).toBe(3);
    expect(t.deliveredAt).toBeNull();
  });

  it("truncates long error messages to 500 chars", () => {
    const t = nextOutboxState({
      success: false,
      attempts: 0,
      error: "x".repeat(900),
    });
    expect(t.lastError && t.lastError.length).toBe(500);
  });
});
