import { AUTH_RATE_LIMITS, GLOBAL_RATE_LIMIT } from "./auth-rate-limits";

describe("AUTH_RATE_LIMITS", () => {
  const entries = Object.entries(AUTH_RATE_LIMITS);

  it("covers exactly the sensitive auth endpoints", () => {
    expect(Object.keys(AUTH_RATE_LIMITS).sort()).toEqual([
      "changePassword",
      "firebase",
      "login",
      "otpRequest",
      "otpVerify",
      "refresh",
      "register",
    ]);
  });

  it.each(entries)("%s is a valid rule stricter than the global limit", (_key, cfg) => {
    expect(cfg.default.limit).toBeGreaterThan(0);
    expect(Number.isInteger(cfg.default.limit)).toBe(true);
    expect(cfg.default.limit).toBeLessThan(GLOBAL_RATE_LIMIT.limit);
    expect(cfg.default.ttl).toBe(GLOBAL_RATE_LIMIT.ttl);
  });

  it("uses the expected per-endpoint limits", () => {
    expect(AUTH_RATE_LIMITS.register.default.limit).toBe(10);
    expect(AUTH_RATE_LIMITS.login.default.limit).toBe(15);
    expect(AUTH_RATE_LIMITS.firebase.default.limit).toBe(15);
    expect(AUTH_RATE_LIMITS.refresh.default.limit).toBe(30);
    expect(AUTH_RATE_LIMITS.otpRequest.default.limit).toBe(5);
    expect(AUTH_RATE_LIMITS.otpVerify.default.limit).toBe(10);
    expect(AUTH_RATE_LIMITS.changePassword.default.limit).toBe(5);
  });

  it("applies the strictest limit to password changes and OTP requests", () => {
    const limits = entries.map(([, c]) => c.default.limit);
    expect(AUTH_RATE_LIMITS.otpRequest.default.limit).toBe(Math.min(...limits));
    expect(AUTH_RATE_LIMITS.changePassword.default.limit).toBe(Math.min(...limits));
  });
});
