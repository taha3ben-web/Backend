import {
  DURATION_BUCKETS_SECONDS,
  escapeLabelValue,
  estimateQuantileSeconds,
  httpSeriesSnapshot,
  httpSummary,
  normalizeRoute,
  recordHttpRequest,
  renderHttpPrometheus,
  resetHttpMetrics,
} from "./http-metrics";

describe("normalizeRoute", () => {
  it("يستبدل المعرّفات الرقمية و UUID بـ :id", () => {
    expect(normalizeRoute("/api/trips/42/track")).toBe("/api/trips/:id/track");
    expect(
      normalizeRoute("/api/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    ).toBe("/api/users/:id");
  });

  it("يحذف سلسلة الاستعلام ويوحّد حالة الأحرف", () => {
    expect(normalizeRoute("/API/Trips?page=2")).toBe("/api/trips");
  });

  it("يتعامل مع المدخلات الفارغة", () => {
    expect(normalizeRoute("")).toBe("unknown");
    expect(normalizeRoute(undefined)).toBe("unknown");
    expect(normalizeRoute("/")).toBe("/");
  });
});

describe("recordHttpRequest", () => {
  beforeEach(() => resetHttpMetrics());

  it("يجمّع الطلبات المتشابهة في سلسلة واحدة", () => {
    recordHttpRequest({ method: "get", path: "/api/trips/1", statusCode: 200, durationMs: 30 });
    recordHttpRequest({ method: "GET", path: "/api/trips/2", statusCode: 200, durationMs: 70 });

    const series = httpSeriesSnapshot();
    expect(series).toHaveLength(1);
    expect(series[0].method).toBe("GET");
    expect(series[0].route).toBe("/api/trips/:id");
    expect(series[0].count).toBe(2);
    expect(series[0].sumSeconds).toBeCloseTo(0.1, 6);
  });

  it("يفصل السلاسل حسب رمز الحالة", () => {
    recordHttpRequest({ method: "GET", path: "/api/health", statusCode: 200, durationMs: 5 });
    recordHttpRequest({ method: "GET", path: "/api/health", statusCode: 503, durationMs: 5 });
    expect(httpSeriesSnapshot()).toHaveLength(2);
  });

  it("يملأ سلال الـ histogram بدلالة le التراكمية", () => {
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

  it("يحسب معدل أخطاء الخادم دون احتساب 4xx", () => {
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

  it("يعيد قيمًا فارغة بلا بيانات", () => {
    const summary = httpSummary();
    expect(summary.requestsTotal).toBe(0);
    expect(summary.errorRate).toBe(0);
    expect(summary.avgMs).toBeNull();
    expect(summary.p95Ms).toBeNull();
  });

  it("يرتّب المسارات الأكثر استدعاءً أولًا", () => {
    recordHttpRequest({ method: "GET", path: "/rare", statusCode: 200, durationMs: 10 });
    for (let i = 0; i < 3; i += 1) {
      recordHttpRequest({ method: "GET", path: "/hot", statusCode: 200, durationMs: 10 });
    }
    expect(httpSummary().topRoutes[0].route).toBe("/hot");
  });
});

describe("estimateQuantileSeconds", () => {
  beforeEach(() => resetHttpMetrics());

  it("يعيد null بلا عيّنات", () => {
    expect(estimateQuantileSeconds([], 0.95)).toBeNull();
  });

  it("يعيد حدّ السلّة التي تبلغها الكمّية", () => {
    for (let i = 0; i < 100; i += 1) {
      recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 5 });
    }
    expect(estimateQuantileSeconds(httpSeriesSnapshot(), 0.95)).toBe(0.01);
  });
});

describe("renderHttpPrometheus", () => {
  beforeEach(() => resetHttpMetrics());

  it("لا يُخرج شيئًا بلا بيانات", () => {
    expect(renderHttpPrometheus()).toEqual([]);
  });

  it("يُخرج histogram واحدًا لكل (method, route) رغم تعدد رموز الحالة", () => {
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

  it("يُنهي كل histogram بسلّة +Inf", () => {
    recordHttpRequest({ method: "GET", path: "/a", statusCode: 200, durationMs: 99999 });
    const lines = renderHttpPrometheus();
    expect(lines.some((l) => l.includes('le="+Inf"} 1'))).toBe(true);
  });
});

describe("escapeLabelValue", () => {
  it("يهرّب علامات الاقتباس والشرطة الخلفية", () => {
    expect(escapeLabelValue('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
