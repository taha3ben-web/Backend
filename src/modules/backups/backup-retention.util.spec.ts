import {
  computeDrStatus,
  DEFAULT_RETENTION_POLICY,
  formatSizeMb,
  nextBackupDue,
  selectRetained,
} from "./backup-retention.util";

function cand(id: string, iso: string) {
  return { id, timestamp: new Date(iso) };
}

describe("backup-retention.util", () => {
  describe("selectRetained", () => {
    it("يستبقي أحدث N نسخ (keepLatest)", () => {
      const candidates = [
        cand("a", "2026-01-10T00:00:00Z"),
        cand("b", "2026-01-09T00:00:00Z"),
        cand("c", "2026-01-08T00:00:00Z"),
      ];
      const res = selectRetained(candidates, {
        keepLatest: 2,
        keepDaily: 0,
        keepWeekly: 0,
        keepMonthly: 0,
      });
      expect(res.retainIds).toContain("a");
      expect(res.retainIds).toContain("b");
      expect(res.pruneIds).toContain("c");
    });

    it("الاستبقاء والتقليم متكاملان (لا تداخل)", () => {
      const candidates = [
        cand("a", "2026-01-10T00:00:00Z"),
        cand("b", "2026-01-03T00:00:00Z"),
        cand("c", "2025-12-20T00:00:00Z"),
        cand("d", "2025-11-01T00:00:00Z"),
      ];
      const res = selectRetained(candidates, DEFAULT_RETENTION_POLICY);
      const all = [...res.retainIds, ...res.pruneIds].sort();
      expect(all).toEqual(["a", "b", "c", "d"]);
      const overlap = res.retainIds.filter((id) => res.pruneIds.includes(id));
      expect(overlap).toEqual([]);
    });

    it("يتجاهل المرشّحين ذوي الطابع الزمني غير الصالح", () => {
      const res = selectRetained(
        [
          { id: "good", timestamp: new Date("2026-01-10T00:00:00Z") },
          { id: "bad", timestamp: new Date("invalid") },
        ],
        DEFAULT_RETENTION_POLICY,
      );
      expect(res.retainIds).toEqual(["good"]);
      expect(res.pruneIds).toEqual([]);
    });

    it("يتعامل مع قائمة فارغة", () => {
      const res = selectRetained([], DEFAULT_RETENTION_POLICY);
      expect(res.retainIds).toEqual([]);
      expect(res.pruneIds).toEqual([]);
    });
  });

  describe("computeDrStatus", () => {
    const now = new Date("2026-01-10T12:00:00Z");

    it("سليم حين آخر نسخة داخل RPO", () => {
      const st = computeDrStatus(now, new Date("2026-01-10T11:30:00Z"), 60);
      expect(st.healthy).toBe(true);
      expect(st.breached).toBe(false);
      expect(st.ageMinutes).toBe(30);
    });

    it("مخروق حين تجاوز RPO", () => {
      const st = computeDrStatus(now, new Date("2026-01-10T10:00:00Z"), 60);
      expect(st.healthy).toBe(false);
      expect(st.breached).toBe(true);
      expect(st.ageMinutes).toBe(120);
    });

    it("غير سليم حين لا توجد نسخة ناجحة", () => {
      const st = computeDrStatus(now, null, 60);
      expect(st.healthy).toBe(false);
      expect(st.breached).toBe(true);
      expect(st.ageMinutes).toBeNull();
      expect(st.lastSuccessfulAt).toBeNull();
    });
  });

  describe("nextBackupDue", () => {
    it("يضيف الفترة إلى آخر نسخة", () => {
      const due = nextBackupDue(new Date("2026-01-10T00:00:00Z"), 120);
      expect(due?.toISOString()).toBe("2026-01-10T02:00:00.000Z");
    });

    it("يُرجع null حين لا تاريخ سابق", () => {
      expect(nextBackupDue(null, 120)).toBeNull();
    });
  });

  describe("formatSizeMb", () => {
    it("ينسّق الميجابايت", () => {
      expect(formatSizeMb(512)).toBe("512 MB");
    });
    it("يحوّل إلى جيجابايت", () => {
      expect(formatSizeMb(2048)).toBe("2.00 GB");
    });
    it("يُرجع شرطة للقيم غير الصالحة", () => {
      expect(formatSizeMb(null)).toBe("-");
      expect(formatSizeMb(-5)).toBe("-");
    });
  });
});
