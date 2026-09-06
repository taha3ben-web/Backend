import {
  RUNTIME_COUNTERS,
  RUNTIME_GAUGES,
  bumpCounter,
  counterValue,
  estimateHistogramQuantile,
  gaugeValue,
  histogramState,
  histogramSummary,
  observeHistogram,
  renderRuntimePrometheus,
  resetRuntimeMetrics,
  runtimeMetricsSnapshot,
  safeMetric,
  setGauge,
  type RuntimeCounterName,
} from "./runtime-metrics";

describe("runtime counters", () => {
  beforeEach(() => resetRuntimeMetrics());

  it("\u064a\u0632\u064a\u062f \u0627\u0644\u0639\u062f\u0651\u0627\u062f\u0627\u062a \u0628\u0634\u0643\u0644 \u0635\u062d\u064a\u062d", () => {
    bumpCounter("matching_requests_total");
    bumpCounter("matching_requests_total");
    bumpCounter("outbox_delivered_total", 5);
    expect(counterValue("matching_requests_total")).toBe(2);
    expect(counterValue("outbox_delivered_total")).toBe(5);
  });

  it("\u064a\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u0623\u0633\u0645\u0627\u0621 \u063a\u064a\u0631 \u0627\u0644\u0645\u0639\u0631\u0651\u0641\u0629 \u0641\u0644\u0627 \u064a\u0646\u0645\u0648 \u0627\u0644\u0645\u062e\u0632\u0646", () => {
    bumpCounter("per_driver_9d3f" as unknown as RuntimeCounterName);
    const snapshot = runtimeMetricsSnapshot();
    expect(Object.keys(snapshot.counters)).toHaveLength(RUNTIME_COUNTERS.length);
    expect(snapshot.counters["per_driver_9d3f"]).toBeUndefined();
  });

  it("\u064a\u062a\u062c\u0627\u0647\u0644 \u0627\u0644\u0632\u064a\u0627\u062f\u0627\u062a \u063a\u064a\u0631 \u0627\u0644\u0645\u0646\u062a\u0647\u064a\u0629", () => {
    bumpCounter("matching_requests_total", Number.NaN);
    expect(counterValue("matching_requests_total")).toBe(0);
  });

  it("\u064a\u0628\u0642\u064a \u0639\u062f\u062f \u0627\u0644\u0645\u0641\u0627\u062a\u064a\u062d \u062b\u0627\u0628\u062a\u064b\u0627 \u062a\u062d\u062a \u062d\u0645\u0644 \u0643\u0628\u064a\u0631 (bounded memory)", () => {
    for (let i = 0; i < 20000; i += 1) {
      bumpCounter("outbox_dispatch_attempted_total");
      observeHistogram("outbox_dispatch_duration_ms", i % 7000);
    }
    const snapshot = runtimeMetricsSnapshot();
    expect(Object.keys(snapshot.counters)).toHaveLength(RUNTIME_COUNTERS.length);
    expect(Object.keys(snapshot.gauges)).toHaveLength(RUNTIME_GAUGES.length);
    expect(Object.keys(snapshot.histograms)).toHaveLength(3);
    expect(histogramState("outbox_dispatch_duration_ms")?.buckets).toHaveLength(10);
  });
});

describe("runtime gauges", () => {
  beforeEach(() => resetRuntimeMetrics());

  it("\u064a\u062d\u062a\u0641\u0632 \u0628\u0622\u062e\u0631 \u0642\u064a\u0645\u0629 \u0641\u0642\u0637", () => {
    setGauge("outbox_last_batch_size", 50);
    setGauge("outbox_last_batch_size", 7);
    expect(gaugeValue("outbox_last_batch_size")).toBe(7);
  });
});

describe("runtime histograms", () => {
  beforeEach(() => resetRuntimeMetrics());

  it("\u064a\u0633\u062c\u0651\u0644 \u0645\u0634\u0627\u0647\u062f\u0627\u062a \u0627\u0644\u0632\u0645\u0646 \u0628\u062f\u0644\u0627\u0644\u0629 le \u0627\u0644\u062a\u0631\u0627\u0643\u0645\u064a\u0629", () => {
    observeHistogram("matching_duration_ms", 40);
    const state = histogramState("matching_duration_ms");
    expect(state?.count).toBe(1);
    expect(state?.sum).toBe(40);
    // السلال: 5,10,25,50,... فالمشاهدة 40ms تقع في 50 وما فوق فقط.
    expect(state?.buckets[2]).toBe(0);
    expect(state?.buckets[3]).toBe(1);
  });

  it("\u064a\u0642\u062f\u0631 \u0627\u0644\u0643\u0645\u0651\u064a\u0627\u062a p50/p95/p99", () => {
    for (let i = 0; i < 100; i += 1) observeHistogram("matching_duration_ms", 3);
    expect(estimateHistogramQuantile("matching_duration_ms", 0.5)).toBe(5);
    const summary = histogramSummary("matching_duration_ms");
    expect(summary.count).toBe(100);
    expect(summary.avg).toBe(3);
    expect(summary.p95).toBe(5);
    expect(summary.p99).toBe(5);
  });

  it("\u064a\u0639\u064a\u062f \u0642\u064a\u0645\u064b\u0627 \u0641\u0627\u0631\u063a\u0629 \u0628\u0644\u0627 \u0645\u0634\u0627\u0647\u062f\u0627\u062a", () => {
    const summary = histogramSummary("matching_candidate_count");
    expect(summary.count).toBe(0);
    expect(summary.p50).toBeNull();
    expect(estimateHistogramQuantile("matching_candidate_count", 0.5)).toBeNull();
  });
});

describe("safeMetric", () => {
  beforeEach(() => resetRuntimeMetrics());

  it("\u064a\u0628\u062a\u0644\u0639 \u0623\u064a \u062e\u0644\u0644 \u0641\u064a \u0627\u0644\u0642\u064a\u0627\u0633", () => {
    expect(() =>
      safeMetric(() => {
        throw new Error("metrics store exploded");
      }),
    ).not.toThrow();
  });
});

describe("renderRuntimePrometheus", () => {
  beforeEach(() => resetRuntimeMetrics());

  it("\u064a\u064f\u062e\u0631\u062c \u0623\u0633\u0637\u0631\u064b\u0627 \u0628\u0644\u0627 \u062a\u0633\u0645\u064a\u0627\u062a \u0645\u062a\u063a\u064a\u0651\u0631\u0629", () => {
    bumpCounter("matching_success_total", 3);
    observeHistogram("matching_duration_ms", 12);
    const lines = renderRuntimePrometheus();
    expect(lines).toContain("nova_matching_success_total 3");
    expect(
      lines.some((l) => l.startsWith("nova_matching_duration_seconds_count")),
    ).toBe(true);
    expect(lines.some((l) => l.includes('le="+Inf"'))).toBe(true);
    // لا تسميات عالية الكاردينالية مطلقًا.
    for (const forbidden of ["userId", "tripId", "driverId", "requestId"]) {
      expect(lines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("\u064a\u064f\u0635\u0641\u0651\u0631 \u0643\u0644 \u0634\u064a\u0621 \u0639\u0646\u062f \u0627\u0644\u0625\u0639\u0627\u062f\u0629", () => {
    bumpCounter("outbox_dead_total", 2);
    setGauge("outbox_last_batch_size", 9);
    observeHistogram("outbox_dispatch_duration_ms", 100);
    resetRuntimeMetrics();
    expect(counterValue("outbox_dead_total")).toBe(0);
    expect(gaugeValue("outbox_last_batch_size")).toBe(0);
    expect(histogramState("outbox_dispatch_duration_ms")?.count).toBe(0);
  });
});
