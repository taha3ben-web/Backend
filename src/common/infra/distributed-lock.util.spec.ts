import {
  lockBackoffMs,
  lockKey,
  withJitter,
  LOCK_RETRY_BASE_MS,
  LOCK_RETRY_MAX_MS,
  LOCK_KEY_PREFIX,
} from "./distributed-lock.util";

describe("distributed lock helpers", () => {
  it("prefixes lock keys", () => {
    expect(lockKey("withdraw:user:1")).toBe(`${LOCK_KEY_PREFIX}withdraw:user:1`);
  });

  it("computes capped exponential backoff", () => {
    expect(lockBackoffMs(0)).toBe(0);
    expect(lockBackoffMs(1)).toBe(LOCK_RETRY_BASE_MS);
    expect(lockBackoffMs(2)).toBe(LOCK_RETRY_BASE_MS * 2);
    expect(lockBackoffMs(3)).toBe(LOCK_RETRY_BASE_MS * 4);
    expect(lockBackoffMs(99)).toBe(LOCK_RETRY_MAX_MS);
  });

  it("applies full jitter within [ms/2, ms]", () => {
    expect(withJitter(100, () => 0)).toBe(50);
    expect(withJitter(100, () => 1)).toBe(100);
    expect(withJitter(100, () => 0.5)).toBe(75);
    expect(withJitter(0)).toBe(0);
  });
});
