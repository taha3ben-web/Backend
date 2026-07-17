import {
  buildSpanRecord,
  buildTraceparent,
  generateSpanId,
  generateTraceId,
  isSampled,
  isValidSpanId,
  isValidTraceId,
  parseTraceparent,
  spanDurationMs,
} from "./tracing.util";

describe("tracing.util", () => {
  describe("id generation", () => {
    it("generates valid trace/span ids", () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(isValidTraceId(traceId)).toBe(true);
      expect(isValidSpanId(spanId)).toBe(true);
    });
    it("rejects all-zero ids", () => {
      expect(isValidTraceId("0".repeat(32))).toBe(false);
      expect(isValidSpanId("0".repeat(16))).toBe(false);
    });
  });

  describe("parseTraceparent", () => {
    it("parses a valid W3C header", () => {
      const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const spanId = "00f067aa0ba902b7";
      const parsed = parseTraceparent(`00-${traceId}-${spanId}-01`);
      expect(parsed).not.toBeNull();
      expect(parsed?.traceId).toBe(traceId);
      expect(parsed?.spanId).toBe(spanId);
      expect(isSampled(parsed!.flags)).toBe(true);
    });
    it("returns null for malformed headers", () => {
      expect(parseTraceparent(undefined)).toBeNull();
      expect(parseTraceparent("garbage")).toBeNull();
      expect(
        parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`),
      ).toBeNull();
      expect(
        parseTraceparent(
          "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        ),
      ).toBeNull();
    });
    it("is round-trippable with buildTraceparent", () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const header = buildTraceparent({ traceId, spanId, sampled: true });
      const parsed = parseTraceparent(header);
      expect(parsed?.traceId).toBe(traceId);
      expect(parsed?.spanId).toBe(spanId);
    });
    it("encodes sampled=false", () => {
      const header = buildTraceparent({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        sampled: false,
      });
      expect(header.endsWith("-00")).toBe(true);
    });
  });

  describe("spanDurationMs", () => {
    it("computes non-negative duration", () => {
      expect(spanDurationMs(100, 350)).toBe(250);
      expect(spanDurationMs(500, 400)).toBe(0);
    });
  });

  describe("buildSpanRecord", () => {
    it("defaults status to OK and computes duration", () => {
      const rec = buildSpanRecord({
        name: "settleTrip",
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        startTimeMs: 1000,
        endTimeMs: 1200,
        attributes: { tripId: "t1" },
      });
      expect(rec.status).toBe("OK");
      expect(rec.durationMs).toBe(200);
      expect(rec.attributes).toEqual({ tripId: "t1" });
    });
    it("marks ERROR when error present", () => {
      const rec = buildSpanRecord({
        name: "settleTrip",
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        startTimeMs: 1000,
        endTimeMs: 1050,
        error: "boom",
      });
      expect(rec.status).toBe("ERROR");
      expect(rec.error).toBe("boom");
    });
    it("omits empty attributes", () => {
      const rec = buildSpanRecord({
        name: "x",
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        startTimeMs: 0,
        endTimeMs: 1,
        attributes: {},
      });
      expect("attributes" in rec).toBe(false);
    });
  });
});
