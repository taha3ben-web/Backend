import {
  buildLogRecord,
  generateId,
  getRequestContext,
  normalizeIncomingId,
  runWithRequestContext,
} from "./request-context";

describe("request-context", () => {
  it("normalizes valid incoming ids and rejects junk", () => {
    expect(normalizeIncomingId("abc-123")).toBe("abc-123");
    expect(normalizeIncomingId(["first", "second"])).toBe("first");
    expect(normalizeIncomingId(undefined)).toBeUndefined();
    expect(normalizeIncomingId("  ")).toBeUndefined();
    expect(normalizeIncomingId("has space")).toBeUndefined();
    expect(normalizeIncomingId("x".repeat(300))).toBeUndefined();
  });

  it("generates unique correlation ids", () => {
    expect(generateId()).not.toBe(generateId());
  });

  it("exposes the active context only inside runWithRequestContext", () => {
    expect(getRequestContext()).toBeUndefined();
    const ctx = { requestId: "r1", traceId: "t1" };
    const seen = runWithRequestContext(ctx, () => getRequestContext());
    expect(seen).toBe(ctx);
    expect(getRequestContext()).toBeUndefined();
  });

  it("builds a structured record enriched with request context", () => {
    const record = buildLogRecord({
      level: "log",
      message: "hello",
      context: "Test",
      now: new Date("2026-07-14T00:00:00.000Z"),
      requestContext: {
        requestId: "r1",
        traceId: "t1",
        actorId: "u1",
        method: "GET",
        path: "/api/health",
      },
    });
    expect(record).toMatchObject({
      level: "log",
      time: "2026-07-14T00:00:00.000Z",
      message: "hello",
      context: "Test",
      requestId: "r1",
      traceId: "t1",
      actorId: "u1",
      method: "GET",
      path: "/api/health",
    });
  });

  it("omits correlation fields when no request context is present", () => {
    const record = buildLogRecord({ level: "warn", message: "no-ctx" });
    expect(record.requestId).toBeUndefined();
    expect(record.traceId).toBeUndefined();
    expect(record.level).toBe("warn");
  });
});
