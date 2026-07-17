import {
  buildOpsHealth,
  rollupSeverity,
  thresholdSeverity,
} from "./ops-center.util";

describe("ops-center.util", () => {
  describe("thresholdSeverity", () => {
    it("maps counts to severity bands", () => {
      expect(thresholdSeverity(0, 1, 10)).toBe("OK");
      expect(thresholdSeverity(1, 1, 10)).toBe("WARN");
      expect(thresholdSeverity(10, 1, 10)).toBe("CRITICAL");
    });
  });

  describe("rollupSeverity", () => {
    it("returns the worst severity", () => {
      expect(rollupSeverity(["OK", "WARN", "OK"])).toBe("WARN");
      expect(rollupSeverity(["OK", "WARN", "CRITICAL"])).toBe("CRITICAL");
      expect(rollupSeverity([])).toBe("OK");
    });
  });

  describe("buildOpsHealth", () => {
    it("is OK when everything is clean", () => {
      const h = buildOpsHealth({
        pendingSettlements: 3,
        failedSettlements: 0,
        deadLetters: 0,
        openIncidents: 0,
        openRiskReviews: 2,
      });
      expect(h.severity).toBe("OK");
      expect(h.panels).toHaveLength(4);
    });

    it("flags a single failed settlement as WARN", () => {
      const h = buildOpsHealth({
        pendingSettlements: 0,
        failedSettlements: 1,
        deadLetters: 0,
        openIncidents: 0,
        openRiskReviews: 0,
      });
      const panel = h.panels.find((p) => p.key === "settlement");
      expect(panel?.severity).toBe("WARN");
      expect(h.severity).toBe("WARN");
    });

    it("escalates to CRITICAL on any open incident threshold", () => {
      const h = buildOpsHealth({
        pendingSettlements: 0,
        failedSettlements: 0,
        deadLetters: 0,
        openIncidents: 5,
        openRiskReviews: 0,
      });
      const panel = h.panels.find((p) => p.key === "reconciliation");
      expect(panel?.severity).toBe("CRITICAL");
      expect(h.severity).toBe("CRITICAL");
    });

    it("dead letters raise CRITICAL at threshold", () => {
      const h = buildOpsHealth({
        pendingSettlements: 0,
        failedSettlements: 0,
        deadLetters: 20,
        openIncidents: 0,
        openRiskReviews: 0,
      });
      expect(h.severity).toBe("CRITICAL");
    });
  });
});
