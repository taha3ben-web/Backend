import {
  ageMinutes,
  classifyQueue,
  clampRetentionDays,
  computeDlqRatio,
  DEFAULT_QUEUE_THRESHOLDS,
  maxSeverity,
  QUEUE_DEFAULT_RETENTION_DAYS,
  QUEUE_MAX_RETENTION_DAYS,
  QUEUE_MIN_RETENTION_DAYS,
  retentionCutoff,
} from "./queue-insight.util";

function counts(pending: number, failed: number, delivered: number, dead: number) {
  return { pending, failed, delivered, dead };
}

describe("queue-insight.util", () => {
  describe("maxSeverity", () => {
    it("يُرجع الأشدّ", () => {
      expect(maxSeverity("healthy", "warning")).toBe("warning");
      expect(maxSeverity("critical", "warning")).toBe("critical");
      expect(maxSeverity("healthy", "healthy")).toBe("healthy");
    });
  });

  describe("computeDlqRatio", () => {
    it("صفر عند إجمالي صفر", () => {
      expect(computeDlqRatio(0, 0)).toBe(0);
    });
    it("يحسب النسبة", () => {
      expect(computeDlqRatio(90, 10)).toBeCloseTo(0.1, 5);
    });
  });

  describe("ageMinutes", () => {
    it("يحوّل لأسفل", () => {
      expect(ageMinutes(125_000)).toBe(2);
    });
    it("null يبقى null", () => {
      expect(ageMinutes(null)).toBeNull();
    });
  });

  describe("clampRetentionDays", () => {
    it("يقيّد للحد الأدنى", () => {
      expect(clampRetentionDays(0)).toBe(QUEUE_MIN_RETENTION_DAYS);
    });
    it("يقيّد للحد الأقصى", () => {
      expect(clampRetentionDays(9_999)).toBe(QUEUE_MAX_RETENTION_DAYS);
    });
    it("يستخدم الافتراضي للقيمة غير الرقمية", () => {
      expect(clampRetentionDays(undefined)).toBe(QUEUE_DEFAULT_RETENTION_DAYS);
    });
  });

  describe("retentionCutoff", () => {
    it("يطرح الأيام من الآن", () => {
      const now = new Date("2026-01-15T00:00:00Z");
      expect(retentionCutoff(now, 2).toISOString()).toBe("2026-01-13T00:00:00.000Z");
    });
  });

  describe("classifyQueue", () => {
    it("سليم تحت العتبات", () => {
      const res = classifyQueue({ counts: counts(5, 0, 100, 0), oldestPendingAgeMs: 1_000 });
      expect(res.severity).toBe("healthy");
      expect(res.backlog).toBe(5);
      expect(res.stalled).toBe(false);
    });

    it("تحذير عند تراكم مرتفع", () => {
      const res = classifyQueue({
        counts: counts(DEFAULT_QUEUE_THRESHOLDS.backlogWarn, 0, 0, 0),
        oldestPendingAgeMs: 0,
      });
      expect(res.severity).toBe("warning");
    });

    it("حرِج عند تراكم حرِج", () => {
      const res = classifyQueue({
        counts: counts(DEFAULT_QUEUE_THRESHOLDS.backlogCrit, 0, 0, 0),
        oldestPendingAgeMs: 0,
      });
      expect(res.severity).toBe("critical");
    });

    it("حرِج عند تقادم حرِج + متوقّف", () => {
      const res = classifyQueue({
        counts: counts(1, 0, 0, 0),
        oldestPendingAgeMs: DEFAULT_QUEUE_THRESHOLDS.ageCritMs,
      });
      expect(res.severity).toBe("critical");
      expect(res.stalled).toBe(true);
    });

    it("تحذير عند وجود رسائل DLQ", () => {
      const res = classifyQueue({ counts: counts(0, 0, 100, 1), oldestPendingAgeMs: null });
      expect(res.severity).toBe("warning");
      expect(res.dead).toBe(1);
    });

    it("لا توقّف حين التقادم null", () => {
      const res = classifyQueue({ counts: counts(10, 0, 0, 0), oldestPendingAgeMs: null });
      expect(res.stalled).toBe(false);
    });

    it("لا توقّف حين التراكم صفر رغم التقادم", () => {
      const res = classifyQueue({
        counts: counts(0, 0, 0, 0),
        oldestPendingAgeMs: DEFAULT_QUEUE_THRESHOLDS.stallMs + 1,
      });
      expect(res.stalled).toBe(false);
    });

    it("يولّد توصيات دائمًا", () => {
      const res = classifyQueue({ counts: counts(0, 0, 0, 0), oldestPendingAgeMs: null });
      expect(res.recommendations.length).toBeGreaterThan(0);
    });
  });
});
