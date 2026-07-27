import {
  cacheKey,
  cacheTtlFromEnv,
  isExpired,
  matchesPattern,
  stableFingerprint,
} from "./config-cache.util";

describe("config-cache.util", () => {
  it("builds namespaced keys", () => {
    expect(cacheKey("public-config")).toBe("cfg:public-config");
    expect(cacheKey("feature-flags", "abc")).toBe("cfg:feature-flags:abc");
  });

  it("produces the same fingerprint regardless of key order", () => {
    const a = { platform: "ANDROID", cityId: "c1", segments: ["vip"] };
    const b = { segments: ["vip"], cityId: "c1", platform: "ANDROID" };
    expect(stableFingerprint(a)).toBe(stableFingerprint(b));
  });

  it("ignores undefined members but not different values", () => {
    expect(stableFingerprint({ a: 1, b: undefined })).toBe(
      stableFingerprint({ a: 1 }),
    );
    expect(stableFingerprint({ a: 1 })).not.toBe(stableFingerprint({ a: 2 }));
  });

  it("keeps array order significant", () => {
    expect(stableFingerprint([1, 2])).not.toBe(stableFingerprint([2, 1]));
  });

  it("clamps ttl from env", () => {
    expect(cacheTtlFromEnv(undefined)).toBe(60);
    expect(cacheTtlFromEnv("nope")).toBe(60);
    expect(cacheTtlFromEnv("0")).toBe(1);
    expect(cacheTtlFromEnv("99999")).toBe(3600);
    expect(cacheTtlFromEnv("120")).toBe(120);
  });

  it("expires local entries", () => {
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1001, 1000)).toBe(false);
  });

  it("matches invalidation patterns without touching other namespaces", () => {
    expect(matchesPattern("cfg:feature-flags:x", "cfg:feature-flags*")).toBe(
      true,
    );
    expect(matchesPattern("cfg:public-config", "cfg:feature-flags*")).toBe(
      false,
    );
    expect(matchesPattern("cfg:public-config", "*")).toBe(true);
    expect(matchesPattern("cfg:public-config", "cfg:public-config")).toBe(true);
  });
});
