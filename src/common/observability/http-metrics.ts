/**
 * سجل مقاييس HTTP داخل الذاكرة — بلا حزم خارجية وبلا حقن اعتماديات.
 *
 * لماذا لا يكون خدمة Nest تُحقن: المستهلكان هما `LoggingInterceptor` (داخل
 * ObservabilityModule) و `MetricsController` (داخل MetricsModule). حقنه كان
 * سيفرض ربطًا بين الوحدتين ويُدخل خطر فشل DI وقت التشغيل — وهو خطر لا يكشفه
 * البناء ولا الاختبارات. وحدة مستوردة مباشرة أبسط وأأمن، والحالة عالمية أصلًا
 * لأن العملية واحدة.
 *
 * كل الدوال المُصدَّرة نقية باستثناء `recordHttpRequest` و `resetHttpMetrics`.
 */

/** حدود الـ histogram بالثواني — تغطي من 10ms إلى 10s. */
export const DURATION_BUCKETS_SECONDS: readonly number[] = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * سقف عدد السلاسل. الكاردينالية هي القاتل الأول لأي نظام مقاييس: مسار واحد
 * يحمل معرّفًا غير مُطبَّع يكفي لتوليد ملايين السلاسل وإسقاط المخزن.
 */
const MAX_SERIES = Math.max(50, Number(process.env.METRICS_MAX_SERIES ?? 500));

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HttpSeries {
  method: string;
  route: string;
  status: number;
  count: number;
  sumSeconds: number;
  /** عدّادات تراكمية بدلالة `le` — نفس دلالة Prometheus. */
  buckets: number[];
}

const seriesByKey = new Map<string, HttpSeries>();
let droppedSeriesTotal = 0;

/** يحوّل مقطع مسار إلى تسمية ثابتة: كل ما يشبه معرّفًا يصير `:id`. */
function segmentLabel(segment: string): string {
  if (UUID_PATTERN.test(segment)) return ":id";
  if (/^\d+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{24,}$/i.test(segment)) return ":id";
  if (segment.length > 40) return ":id";
  return segment.toLowerCase();
}

/** يطبّع مسار الطلب إلى قالب ثابت قابل للتجميع. دالة نقية. */
export function normalizeRoute(rawPath?: string | null): string {
  const [beforeQuery] = (rawPath ?? "").split("?");
  const trimmed = (beforeQuery ?? "").trim();
  if (!trimmed) return "unknown";
  const segments = trimmed.split("/").filter(Boolean).map(segmentLabel);
  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

/** يسجّل طلبًا مكتملًا. يُستدعى مرة واحدة لكل طلب من الـ interceptor. */
export function recordHttpRequest(args: {
  method?: string;
  path?: string | null;
  statusCode?: number;
  durationMs: number;
}): void {
  const method = (args.method ?? "UNKNOWN").toUpperCase();
  const status = Number.isFinite(args.statusCode) ? Number(args.statusCode) : 0;
  const seconds = Math.max(0, args.durationMs) / 1000;

  let route = normalizeRoute(args.path);
  let key = `${method} ${route} ${status}`;
  if (!seriesByKey.has(key) && seriesByKey.size >= MAX_SERIES) {
    droppedSeriesTotal += 1;
    route = "other";
    key = `${method} ${route} ${status}`;
  }

  const existing = seriesByKey.get(key);
  const state: HttpSeries = existing ?? {
    method,
    route,
    status,
    count: 0,
    sumSeconds: 0,
    buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
  };

  state.count += 1;
  state.sumSeconds += seconds;
  for (let i = 0; i < DURATION_BUCKETS_SECONDS.length; i += 1) {
    if (seconds <= DURATION_BUCKETS_SECONDS[i]) {
      state.buckets[i] += 1;
    }
  }

  if (!existing) seriesByKey.set(key, state);
}

/** لقطة معزولة من السلاسل الحالية (نسخ عميق للـ buckets). */
export function httpSeriesSnapshot(): HttpSeries[] {
  return Array.from(seriesByKey.values()).map((s) => ({
    ...s,
    buckets: [...s.buckets],
  }));
}

/** عدد السلاسل التي جُمّعت تحت `other` بسبب السقف. */
export function droppedSeriesCount(): number {
  return droppedSeriesTotal;
}

/** يمسح كل الحالة — للاختبارات فقط. */
export function resetHttpMetrics(): void {
  seriesByKey.clear();
  droppedSeriesTotal = 0;
}

/**
 * تقدير كمّية (quantile) من الـ histogram. يعيد الحدّ الأعلى للسلّة التي
 * يقع فيها الهدف، أو `null` إن تجاوزها (أي أبطأ من آخر حد).
 */
export function estimateQuantileSeconds(
  series: HttpSeries[],
  quantile: number,
): number | null {
  const total = series.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;
  const target = quantile * total;
  for (let i = 0; i < DURATION_BUCKETS_SECONDS.length; i += 1) {
    const cumulative = series.reduce((sum, s) => sum + (s.buckets[i] ?? 0), 0);
    if (cumulative >= target) return DURATION_BUCKETS_SECONDS[i];
  }
  return null;
}

export interface HttpSummary {
  requestsTotal: number;
  serverErrorsTotal: number;
  clientErrorsTotal: number;
  /** نسبة 5xx إلى الإجمالي (0..1) — مؤشر الخدمة الأول. */
  errorRate: number;
  avgMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  droppedSeries: number;
  topRoutes: Array<{
    method: string;
    route: string;
    count: number;
    avgMs: number;
    serverErrors: number;
  }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** ملخّص جاهز للعرض في نقطة JSON. دالة نقية على اللقطة الممرّرة. */
export function httpSummary(
  series: HttpSeries[] = httpSeriesSnapshot(),
  topLimit = 10,
): HttpSummary {
  const requestsTotal = series.reduce((sum, s) => sum + s.count, 0);
  const serverErrorsTotal = series
    .filter((s) => s.status >= 500)
    .reduce((sum, s) => sum + s.count, 0);
  const clientErrorsTotal = series
    .filter((s) => s.status >= 400 && s.status < 500)
    .reduce((sum, s) => sum + s.count, 0);
  const sumSeconds = series.reduce((sum, s) => sum + s.sumSeconds, 0);

  const byRoute = new Map<
    string,
    { method: string; route: string; count: number; seconds: number; serverErrors: number }
  >();
  for (const s of series) {
    const key = `${s.method} ${s.route}`;
    const entry = byRoute.get(key) ?? {
      method: s.method,
      route: s.route,
      count: 0,
      seconds: 0,
      serverErrors: 0,
    };
    entry.count += s.count;
    entry.seconds += s.sumSeconds;
    if (s.status >= 500) entry.serverErrors += s.count;
    byRoute.set(key, entry);
  }

  const topRoutes = Array.from(byRoute.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, topLimit)
    .map((e) => ({
      method: e.method,
      route: e.route,
      count: e.count,
      avgMs: e.count > 0 ? round2((e.seconds / e.count) * 1000) : 0,
      serverErrors: e.serverErrors,
    }));

  const p95 = estimateQuantileSeconds(series, 0.95);
  const p99 = estimateQuantileSeconds(series, 0.99);

  return {
    requestsTotal,
    serverErrorsTotal,
    clientErrorsTotal,
    errorRate:
      requestsTotal > 0 ? round3(serverErrorsTotal / requestsTotal) : 0,
    avgMs: requestsTotal > 0 ? round2((sumSeconds / requestsTotal) * 1000) : null,
    p95Ms: p95 === null ? null : p95 * 1000,
    p99Ms: p99 === null ? null : p99 * 1000,
    droppedSeries: droppedSeriesTotal,
    topRoutes,
  };
}

/** يهرّب قيمة تسمية Prometheus. دالة نقية. */
export function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

/**
 * يبني أسطر Prometheus. الـ histogram مُجمَّع على (method, route) دون status
 * لأن تكرار نفس مجموعة التسميات في سلسلتين يجعل المخرَج غير صالح.
 */
export function renderHttpPrometheus(
  series: HttpSeries[] = httpSeriesSnapshot(),
): string[] {
  const lines: string[] = [];
  if (series.length === 0) return lines;

  lines.push(
    "# HELP nova_http_requests_total Total HTTP requests handled",
    "# TYPE nova_http_requests_total counter",
  );
  for (const s of series) {
    const labels = `method="${escapeLabelValue(s.method)}",route="${escapeLabelValue(s.route)}",status="${s.status}"`;
    lines.push(`nova_http_requests_total{${labels}} ${s.count}`);
  }

  const byRoute = new Map<
    string,
    { method: string; route: string; count: number; seconds: number; buckets: number[] }
  >();
  for (const s of series) {
    const key = `${s.method} ${s.route}`;
    const entry = byRoute.get(key) ?? {
      method: s.method,
      route: s.route,
      count: 0,
      seconds: 0,
      buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    entry.count += s.count;
    entry.seconds += s.sumSeconds;
    for (let i = 0; i < DURATION_BUCKETS_SECONDS.length; i += 1) {
      entry.buckets[i] += s.buckets[i] ?? 0;
    }
    byRoute.set(key, entry);
  }

  lines.push(
    "# HELP nova_http_request_duration_seconds HTTP request latency",
    "# TYPE nova_http_request_duration_seconds histogram",
  );
  for (const entry of byRoute.values()) {
    const labels = `method="${escapeLabelValue(entry.method)}",route="${escapeLabelValue(entry.route)}"`;
    for (let i = 0; i < DURATION_BUCKETS_SECONDS.length; i += 1) {
      lines.push(
        `nova_http_request_duration_seconds_bucket{${labels},le="${DURATION_BUCKETS_SECONDS[i]}"} ${entry.buckets[i] ?? 0}`,
      );
    }
    lines.push(
      `nova_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${entry.count}`,
      `nova_http_request_duration_seconds_sum{${labels}} ${round3(entry.seconds)}`,
      `nova_http_request_duration_seconds_count{${labels}} ${entry.count}`,
    );
  }

  lines.push(
    "# HELP nova_http_series_dropped_total Series folded into route=other by the cardinality cap",
    "# TYPE nova_http_series_dropped_total counter",
    `nova_http_series_dropped_total ${droppedSeriesTotal}`,
  );

  return lines;
}
