import {
  DEFAULT_BLOCK_THRESHOLD,
  amountAnomalyRatio,
  assessRisk,
  checkVelocity,
  normalizeBlacklistValue,
  scoreToLevel,
} from "./risk.util";

describe("risk.util", () => {
  describe("checkVelocity", () => {
    const now = 1_000_000;
    const limit = { windowMs: 60_000, maxCount: 3, maxAmount: 1000 };

    it("counts only events inside the window", () => {
      const history = [
        { at: now - 10_000, amount: 100 },
        { at: now - 120_000, amount: 999 }, // outside window
      ];
      const r = checkVelocity(history, limit, now);
      expect(r.count).toBe(1);
      expect(r.amount).toBe(100);
      expect(r.exceeded).toBe(false);
    });

    it("includes the pending event and flags count breach", () => {
      const history = [
        { at: now - 5_000 },
        { at: now - 4_000 },
        { at: now - 3_000 },
      ];
      const r = checkVelocity(history, limit, now, { at: now });
      expect(r.count).toBe(4);
      expect(r.exceeded).toBe(true);
      expect(r.reason?.code).toBe("VELOCITY_COUNT");
    });

    it("flags amount breach", () => {
      const history = [{ at: now - 1000, amount: 600 }];
      const r = checkVelocity(history, limit, now, { at: now, amount: 500 });
      expect(r.exceeded).toBe(true);
      expect(r.reason?.code).toBe("VELOCITY_AMOUNT");
    });
  });

  describe("amountAnomalyRatio", () => {
    it("returns 1 when no history", () => {
      expect(amountAnomalyRatio(500, 0)).toBe(1);
    });
    it("computes ratio vs average", () => {
      expect(amountAnomalyRatio(500, 100)).toBe(5);
    });
  });

  describe("scoreToLevel", () => {
    it("maps score to level", () => {
      expect(scoreToLevel(10)).toBe("LOW");
      expect(scoreToLevel(50)).toBe("MEDIUM");
      expect(scoreToLevel(80)).toBe("HIGH");
    });
  });

  describe("assessRisk", () => {
    it("allows a clean low-risk action", () => {
      const r = assessRisk({ amount: 100, avgAmount: 90 });
      expect(r.decision).toBe("ALLOW");
      expect(r.score).toBe(0);
    });

    it("blacklist short-circuits to BLOCK", () => {
      const r = assessRisk({ blacklisted: true, amount: 10 });
      expect(r.decision).toBe("BLOCK");
      expect(r.score).toBe(100);
      expect(r.reasons[0].code).toBe("BLACKLISTED");
    });

    it("active hold short-circuits to BLOCK", () => {
      const r = assessRisk({ hasActiveHold: true });
      expect(r.decision).toBe("BLOCK");
    });

    it("velocity + anomaly pushes to REVIEW", () => {
      const r = assessRisk({
        amount: 500,
        avgAmount: 100,
        velocity: {
          exceeded: true,
          count: 5,
          amount: 5000,
          reason: { code: "VELOCITY_COUNT", weight: 35 },
        },
      });
      // 35 (velocity) + 30 (x5 anomaly) = 65 -> REVIEW (>=40, <70)
      expect(r.score).toBe(65);
      expect(r.decision).toBe("REVIEW");
    });

    it("stacks signals to BLOCK", () => {
      const r = assessRisk({
        amount: 500,
        avgAmount: 100,
        isNewDevice: true,
        chargebackCount: 1,
        velocity: {
          exceeded: true,
          count: 9,
          amount: 9000,
          reason: { code: "VELOCITY_COUNT", weight: 35 },
        },
      });
      // 35 + 30 + 15 + 20 = 100 (capped) -> BLOCK
      expect(r.score).toBeGreaterThanOrEqual(DEFAULT_BLOCK_THRESHOLD);
      expect(r.decision).toBe("BLOCK");
    });

    it("caps score at 100", () => {
      const r = assessRisk({
        amount: 5000,
        avgAmount: 100,
        isNewDevice: true,
        isNewAccount: true,
        chargebackCount: 5,
        velocity: {
          exceeded: true,
          count: 20,
          amount: 99999,
          reason: { code: "VELOCITY_COUNT", weight: 35 },
        },
      });
      expect(r.score).toBe(100);
    });
  });

  describe("normalizeBlacklistValue", () => {
    it("trims and lowercases", () => {
      expect(normalizeBlacklistValue("  ABc123 ")).toBe("abc123");
    });
  });
});
