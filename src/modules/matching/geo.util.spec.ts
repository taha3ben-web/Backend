import { haversineKm, estimateDurationSec } from "./geo.util";

describe("geo.util", () => {
  describe("haversineKm", () => {
    it("returns 0 for identical points", () => {
      expect(haversineKm(36.75, 3.06, 36.75, 3.06)).toBe(0);
    });

    it("is ~111km per degree of latitude at the equator", () => {
      const d = haversineKm(0, 0, 1, 0);
      expect(d).toBeGreaterThan(110);
      expect(d).toBeLessThan(112);
    });

    it("computes the Algiers -> Oran straight-line distance (~350km)", () => {
      const d = haversineKm(36.7538, 3.0588, 35.6971, -0.6331);
      expect(d).toBeGreaterThan(340);
      expect(d).toBeLessThan(360);
    });

    it("is symmetric", () => {
      const a = haversineKm(36.75, 3.06, 35.7, 0.63);
      const b = haversineKm(35.7, 0.63, 36.75, 3.06);
      expect(a).toBeCloseTo(b, 9);
    });
  });

  describe("estimateDurationSec", () => {
    it("returns 0 for non-positive distance", () => {
      expect(estimateDurationSec(0)).toBe(0);
      expect(estimateDurationSec(-5)).toBe(0);
    });

    it("uses a 28km/h urban average by default (28km -> 1h)", () => {
      expect(estimateDurationSec(28)).toBe(3600);
    });

    it("honours a custom average speed", () => {
      expect(estimateDurationSec(60, 60)).toBe(3600);
    });
  });
});
