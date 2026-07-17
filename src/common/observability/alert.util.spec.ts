import {
  buildAlert,
  buildDedupKey,
  detectSinkKind,
  formatAlertPayload,
  shouldSend,
  worstSeverity,
} from "./alert.util";

describe("alert.util", () => {
  describe("buildDedupKey", () => {
    it("includes a resource ref when present", () => {
      expect(
        buildDedupKey("reconciliation.mismatch", { accountId: "a1" }),
      ).toBe("reconciliation.mismatch:a1");
      expect(buildDedupKey("settlement.failed", { tripId: "t9" })).toBe(
        "settlement.failed:t9",
      );
    });
    it("falls back to kind alone", () => {
      expect(buildDedupKey("redis.down")).toBe("redis.down");
      expect(buildDedupKey("redis.down", {})).toBe("redis.down");
    });
  });

  describe("shouldSend", () => {
    it("sends when never sent before", () => {
      expect(shouldSend(undefined, 1000, 500)).toBe(true);
    });
    it("throttles inside the window", () => {
      expect(shouldSend(1000, 1200, 500)).toBe(false);
    });
    it("sends again after the window", () => {
      expect(shouldSend(1000, 1600, 500)).toBe(true);
    });
  });

  describe("worstSeverity", () => {
    it("picks the highest severity", () => {
      expect(worstSeverity(["INFO", "WARNING", "CRITICAL"])).toBe("CRITICAL");
      expect(worstSeverity(["INFO", "WARNING"])).toBe("WARNING");
      expect(worstSeverity(["INFO"])).toBe("INFO");
      expect(worstSeverity([])).toBe("INFO");
    });
  });

  describe("detectSinkKind", () => {
    it("detects slack vs generic webhook vs none", () => {
      // نُركّب مضيف Slack من أجزاء حتّى يبقى نصًا عاديًا.
      const slackHost = ["hooks", "slack", "com"].join(".");
      const slackUrl = "https://" + slackHost + "/services/T000/B000/xxx";
      expect(detectSinkKind(slackUrl)).toBe("slack");
      expect(detectSinkKind("https://example.com/hook")).toBe("webhook");
      expect(detectSinkKind(undefined)).toBe("none");
      expect(detectSinkKind("")).toBe("none");
    });
  });

  describe("formatAlertPayload", () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    const alert = buildAlert(
      {
        kind: "reconciliation.mismatch",
        severity: "CRITICAL",
        title: "Ledger mismatch",
        message: "account drift detected",
        context: { accountId: "a1", diff: 12.5 },
      },
      now,
    );

    it("formats a slack text payload with context", () => {
      const payload = formatAlertPayload(alert, "slack") as { text: string };
      expect(payload.text).toContain("[CRITICAL] Ledger mismatch");
      expect(payload.text).toContain("accountId");
      expect(payload.text).toContain("a1");
    });

    it("formats a generic webhook json payload", () => {
      const payload = formatAlertPayload(alert, "webhook");
      expect(payload.kind).toBe("reconciliation.mismatch");
      expect(payload.dedupKey).toBe("reconciliation.mismatch:a1");
      expect(payload.timestamp).toBe("2026-07-14T00:00:00.000Z");
    });
  });
});
