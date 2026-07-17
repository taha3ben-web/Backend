import {
  validateScheduledTime,
  dispatchAtMs,
  isDueForDispatch,
  validateStops,
  orderStops,
  totalRouteDistanceKm,
  haversineKm,
  MIN_LEAD_MINUTES,
  DEFAULT_DISPATCH_LEAD_MINUTES,
} from "./scheduling.util";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe("scheduling.util", () => {
  describe("validateScheduledTime", () => {
    it("rejects times that are too soon", () => {
      const r = validateScheduledTime(NOW + 5 * MIN, NOW);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("TOO_SOON");
    });
    it("accepts a valid future time", () => {
      const r = validateScheduledTime(NOW + (MIN_LEAD_MINUTES + 5) * MIN, NOW);
      expect(r.valid).toBe(true);
    });
    it("rejects times too far in the future", () => {
      const r = validateScheduledTime(NOW + 40 * 24 * 60 * MIN, NOW);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("TOO_FAR");
    });
    it("rejects non-finite", () => {
      expect(validateScheduledTime(NaN, NOW).valid).toBe(false);
    });
  });

  describe("dispatch timing", () => {
    it("subtracts the lead window", () => {
      const at = NOW + 60 * MIN;
      expect(dispatchAtMs(at)).toBe(at - DEFAULT_DISPATCH_LEAD_MINUTES * MIN);
    });
    it("honors custom lead", () => {
      const at = NOW + 60 * MIN;
      expect(dispatchAtMs(at, 20)).toBe(at - 20 * MIN);
    });
    it("detects due dispatch", () => {
      expect(isDueForDispatch(NOW - 1, NOW)).toBe(true);
      expect(isDueForDispatch(NOW + 1, NOW)).toBe(false);
    });
  });

  describe("stops", () => {
    it("rejects empty stops", () => {
      expect(validateStops([]).reason).toBe("NO_STOPS");
    });
    it("rejects duplicate seq", () => {
      const r = validateStops([
        { seq: 0, lat: 36.7, lng: 3.0 },
        { seq: 0, lat: 36.8, lng: 3.1 },
      ]);
      expect(r.reason).toBe("DUPLICATE_SEQ");
    });
    it("rejects invalid coordinates", () => {
      expect(validateStops([{ seq: 0, lat: 200, lng: 3 }]).reason).toBe(
        "INVALID_COORD",
      );
    });
    it("accepts a valid list", () => {
      expect(
        validateStops([
          { seq: 1, lat: 36.7, lng: 3.0 },
          { seq: 0, lat: 36.8, lng: 3.1 },
        ]).valid,
      ).toBe(true);
    });
    it("orders stops by seq", () => {
      const ordered = orderStops([
        { seq: 2, lat: 1, lng: 1 },
        { seq: 0, lat: 0, lng: 0 },
        { seq: 1, lat: 0.5, lng: 0.5 },
      ]);
      expect(ordered.map((s) => s.seq)).toEqual([0, 1, 2]);
    });
  });

  describe("distance", () => {
    it("computes zero for identical points", () => {
      expect(haversineKm(36.7, 3.0, 36.7, 3.0)).toBeCloseTo(0, 5);
    });
    it("sums the multi-stop route", () => {
      const total = totalRouteDistanceKm({ lat: 36.7, lng: 3.0 }, [
        { seq: 1, lat: 36.9, lng: 3.2 },
        { seq: 0, lat: 36.8, lng: 3.1 },
      ]);
      expect(total).toBeGreaterThan(0);
    });
  });
});
