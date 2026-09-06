import {
  DURATION_BUCKETS_SECONDS,
  escapeLabelValue,
  estimateQuantileSeconds,
  httpMaxSeries,
  httpSeriesCount,
  httpSeriesSnapshot,
  httpStatusClasses,
  httpSummary,
  droppedSeriesCount,
  normalizeRoute,
  recordHttpRequest,
  renderHttpPrometheus,
  resetHttpMetrics,
} from "./http-metrics";

describe("normalizeRoute", () => {
  it("\u064a\u0633\u062a\u0628\u062f\u0644 \u0627\u0644\u0645\u0639\u0631\u0651\u0641\u0627\u062a \u0627\u0644\u0631\u0642\u0645\u064a\u0629 \u0648 UUID \u0628\u0640 :id", () => {
    expect(normalizeRoute("/api/trips/42/track")).toBe("/api/trips/:id/track");
    expect(
      normalizeRoute("/api/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    ).toBe("/api/users/:id");
  });

  it("\u064a\u062d\u0630\u0641 \u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0627\u0633\u062a\u0639\u0644\u0627\u0645 \u0648\u064a\u0648\u062d\u0651\u062f \u062d\u0627\u0644\u0629 \u0627\u0644\u0623\u062d\u0631\u0641", () => {
    expect(normalizeRoute("/API/Trips?page=2")).toBe("/api/trips");
  });

  it("\u064a\u062a\u0639\u0627\u0645\u0644 \u0645\u0639 \u0627\u0644\u0645\u062f\u062e\u0644\u0627\u062a \u0627\u0644\u0641\u0627\u0631\u063a\u0629", () => {
    expect(normalizeRoute("")).toBe("unknown");
    expect(normalizeRoute(undefined)).toBe("unknown");
    expect(normalizeRoute("/")).toBe("/");
  });
});

describe("recordHttpRequest", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u064a\u062c\u0645\u0651\u0639 \u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u062a\u0634\u0627\u0628\u0647\u0629 \u0641\u064a \u0633\u0644\u0633\u0644\u0629 \u0648\u0627\u062d\u062f\u0629", () => {
    recordHttpRequest({ method: "get", path: "/api/trips/1", statusCode: 200, durationMs: 30 });
    recordHttpRequest({ method: "GET", path: "/api/trips/2", statusCode: 200, durationMs: 70 });

    const series = httpSeriesSnapshot();
    expect(series).toHaveLength(1);
    expect(series[0].method).toBe("GET");
    expect(series[0].route).toBe("/api/trips/:id");
    expect(series[0].count).toBe(2);
    expect(series[0].sumSeconds).toBeCloseTo(0.1, 6);
  });

  it("\u064a\u0641\u0635\u0644 \u0627\u0644\u0633\u0644\u0627\u0633\u0644 \u062d\u0633\u0628 \u0631\u0645\u0632 \u0627\u0644\u062d\u0627\u0644\u0629", () => {
    recordHttpRequest({ method: "GET", path: "/api/health", statusCode: 200, durationMs: 5 });
    recordHttpRequest({ method: "GET", path: "/api/health", statusCode: 503, durationMs: 5 });
    expect(httpSeriesSnapshot()).toHaveLength(2);
  });

  it("\u064a\u0645\u0644\u0623 \u0633\u0644\u0627\u0644 \u0627\u0644\u0640 histogram \u0628\u062f\u0644\u0627\u0644\u0629 le \u0627\u0644\u062a\u0631\u0627\u0643\u0645\u064a\u0629", () => {
    recordHttpRequest({ method: "GET", path: "/api/x", statusCode: 200, durationMs: 40 });
    const [series] = httpSeriesSnapshot();
    const idx10ms = DURATION_BUCKETS_SECONDS.indexOf(0.01);
    const idx50ms = DURATION_BUCKETS_SECONDS.indexOf(0.05);
    expect(series.buckets[idx10ms]).toBe(0);
    expect(series.buckets[idx50ms]).toBe(1);
  });
});

describe("httpSummary", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u064a\u062d\u0633\u0628 \u0645\u0639\u062f\u0644 \u0623\u062e\u0637\u0627\u0621 \u0627\u0644\u062e\u0627\u062f\u0645 \u062f\u0648\u0646 \u0627\u062d\u062a\u0633\u0627\u0628 4xx", () => {
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 404, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 500, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 500, durationMs: 10 });

    const summary = httpSummary();
    expect(summary.requestsTotal).toBe(4);
    expect(summary.clientErrorsTotal).toBe(1);
    expect(summary.serverErrorsTotal).toBe(2);
    expect(summary.errorRate).toBe(0.5);
  });

  it("\u064a\u0639\u064a\u062f \u0642\u064a\u0645\u064b\u0627 \u0641\u0627\u0631\u063a\u0629 \u0628\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a", () => {
    const summary = httpSummary();
    expect(summary.requestsTotal).toBe(0);
    expect(summary.errorRate).toBe(0);
    expect(summary.avgMs).toBeNull();
    expect(summary.p50Ms).toBeNull();
    expect(summary.p95Ms).toBeNull();
  });

  it("\u064a\u0631\u062a\u0651\u0628 \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062a \u0627\u0644\u0623\u0643\u062b\u0631 \u0627\u0633\u062a\u062f\u0639\u0627\u0621\u064b \u0623\u0648\u0644\u064b\u0627", () => {
    recordHttpRequest({ method: "GET", path: "/rare", statusCode: 200, durationMs: 10 });
    for (let i = 0; i < 3; i += 1) {
      recordHttpRequest({ method: "GET", path: "/hot", statusCode: 200, durationMs: 10 });
    }
    expect(httpSummary().topRoutes[0].route).toBe("/hot");
  });

  it("\u064a\u0639\u0631\u0636 p50 \u0648\u0633\u0642\u0641 \u0627\u0644\u0633\u0644\u0627\u0633\u0644 \u0648\u0639\u062f\u062f\u0647\u0627", () => {
    for (let i = 0; i < 10; i += 1) {
      recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 5 });
    }
    const summary = httpSummary();
    expect(summary.p50Ms).toBe(10);
    expect(summary.seriesCount).toBe(1);
    expect(summary.maxSeries).toBe(httpMaxSeries());
  });
});

describe("httpStatusClasses", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u064a\u0641\u0635\u0644 429 \u0639\u0646 2xx \u0648\u064a\u0639\u062f\u0651\u0647 \u062f\u0627\u062e\u0644 4xx", () => {
    recordHttpRequest({ method: "POST", path: "/api/auth/otp", statusCode: 200, durationMs: 10 });
    recordHttpRequest({ method: "POST", path: "/api/auth/otp", statusCode: 429, durationMs: 1 });
    recordHttpRequest({ method: "POST", path: "/api/auth/otp", statusCode: 429, durationMs: 1 });

    const classes = httpStatusClasses();
    expect(classes.c2xx).toBe(1);
    expect(classes.c429).toBe(2);
    expect(classes.c4xx).toBe(2);
    expect(classes.c5xx).toBe(0);
  });

  it("\u0644\u0627 \u064a\u062d\u062a\u0633\u0628 401 \u0648\u0644\u0627 404 \u0648\u0644\u0627 5xx \u0646\u062c\u0627\u062d\u064b\u0627", () => {
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 200, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 401, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 404, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 429, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 500, durationMs: 10 });

    const classes = httpStatusClasses();
    // النجاح هو 2xx وحده: خمس طلبات وواحد فقط ناجح.
    expect(classes.c2xx).toBe(1);
    expect(classes.c4xx).toBe(3);
    expect(classes.c429).toBe(1);
    expect(classes.c5xx).toBe(1);
    expect(httpSummary().requestsTotal).toBe(5);
  });

  it("\u064a\u0639\u062f\u0651 408 \u0648 504 \u0645\u0647\u0644\u0627\u062a \u0645\u0639\u0644\u0646\u0629", () => {
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 408, durationMs: 15000 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 504, durationMs: 15000 });
    recordHttpRequest({ method: "GET", path: "/api/a", statusCode: 200, durationMs: 5 });
    expect(httpStatusClasses().timeoutStatus).toBe(2);
  });

  it("\u064a\u0635\u0646\u0651\u0641 \u0627\u0644\u0631\u0645\u0648\u0632 \u063a\u064a\u0631 \u0627\u0644\u0645\u0639\u0631\u0648\u0641\u0629 \u062a\u062d\u062a other", () => {
    recordHttpRequest({ method: "GET", path: "/api/a", durationMs: 5 });
    expect(httpStatusClasses().other).toBe(1);
    expect(httpStatusClasses().c2xx).toBe(0);
  });
});

describe("cardinality cap", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u064a\u0628\u0642\u064a \u0639\u062f\u062f \u0627\u0644\u0633\u0644\u0627\u0633\u0644 \u0645\u0642\u064a\u0651\u062f\u064b\u0627 \u0645\u0647\u0645\u0627 \u0643\u062b\u0631\u062a \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062a", () => {
    const cap = httpMaxSeries();
    for (let i = 0; i < cap + 200; i += 1) {
      recordHttpRequest({
        method: "GET",
        path: `/api/route-${i}-x`,
        statusCode: 200,
        durationMs: 5,
      });
    }
    expect(droppedSeriesCount()).toBeGreaterThan(0);
    // الزيادة الممكنة فوق السقف محدودة بسلاسل route="other" لكل (method, status).
    expect(httpSeriesCount()).toBeLessThanOrEqual(cap + 8);
    expect(
      httpSeriesSnapshot().some((s) => s.route === "other"),
    ).toBe(true);
  });
});

describe("estimateQuantileSeconds", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u064a\u0639\u064a\u062f null \u0628\u0644\u0627 \u0639\u064a\u0651\u0646\u0627\u062a", () => {
    expect(estimateQuantileSeconds([], 0.95)).toBeNull();
  });

  it("\u064a\u0639\u064a\u062f \u062d\u062f\u0651 \u0627\u0644\u0633\u0644\u0651\u0629 \u0627\u0644\u062a\u064a \u062a\u0628\u0644\u063a\u0647\u0627 \u0627\u0644\u0643\u0645\u0651\u064a\u0629", () => {
    for (let i = 0; i < 100; i += 1) {
      recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 5 });
    }
    expect(estimateQuantileSeconds(httpSeriesSnapshot(), 0.95)).toBe(0.01);
  });
});

describe("renderHttpPrometheus", () => {
  beforeEach(() => resetHttpMetrics());

  it("\u0644\u0627 \u064a\u064f\u062e\u0631\u062c \u0634\u064a\u0626\u064b\u0627 \u0628\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a", () => {
    expect(renderHttpPrometheus()).toEqual([]);
  });

  it("\u064a\u064f\u062e\u0631\u062c histogram \u0648\u0627\u062d\u062f\u064b\u0627 \u0644\u0643\u0644 (method, route) \u0631\u063a\u0645 \u062a\u0639\u062f\u062f \u0631\u0645\u0648\u0632 \u0627\u0644\u062d\u0627\u0644\u0629", () => {
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 10 });
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 500, durationMs: 10 });

    const lines = renderHttpPrometheus();
    const counts = lines.filter((l) =>
      l.startsWith("nova_http_request_duration_seconds_count"),
    );
    expect(counts).toHaveLength(1);
    expect(counts[0]).toContain("} 2");

    const totals = lines.filter((l) => l.startsWith("nova_http_requests_total{"));
    expect(totals).toHaveLength(2);
  });

  it("\u064a\u064f\u0646\u0647\u064a \u0643\u0644 histogram \u0628\u0633\u0644\u0651\u0629 +Inf", () => {
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 99999 });
    const lines = renderHttpPrometheus();
    expect(lines.some((l) => l.includes('le="+Inf"} 1'))).toBe(true);
  });

  it("\u064a\u064f\u0635\u062f\u0631 \u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u062d\u0627\u0644\u0629 \u0643\u0633\u062a \u0633\u0644\u0627\u0633\u0644 \u062b\u0627\u0628\u062a\u0629", () => {
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 429, durationMs: 1 });
    const lines = renderHttpPrometheus();
    expect(lines).toContain('nova_http_status_class_total{class="429"} 1');
    expect(lines).toContain('nova_http_status_class_total{class="2xx"} 0');
    expect(
      lines.filter((l) => l.startsWith("nova_http_status_class_total{")),
    ).toHaveLength(6);
  });
});

describe("escapeLabelValue", () => {
  it("\u064a\u0647\u0631\u0651\u0628 \u0639\u0644\u0627\u0645\u0627\u062a \u0627\u0644\u0627\u0642\u062a\u0628\u0627\u0633 \u0648\u0627\u0644\u0634\u0631\u0637\u0629 \u0627\u0644\u062e\u0644\u0641\u064a\u0629", () => {
    expect(escapeLabelValue('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
