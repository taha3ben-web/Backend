/**
 * سجل مقاييس زمن التشغيل داخل الذاكرة — عدّادات ومؤشّرات و histograms،
 * بلا حزم خارجية، وبلا حقن اعتماديات، وبلا أي I/O.
 *
 * لماذا وحدة مستوردة مباشرة لا خدمة Nest تُحقن: نفس سبب `http-metrics.ts`.
 * المستهلكون هنا ثلاثة في طبقات مختلفة: `OutboxService` (common/infra)،
 * و`MatchingEngineService` (modules/matching/engine)، و`MetricsController`
 * (modules/metrics). حقن خدمة فيها كان سيضيف مُعامِلات جديدة إلى مُنشئات خدمات
 * حرجة ويُدخل خطر فشل DI وقت التشغيل — خطر لا يكشفه البناء ولا يكشفه أغلب
 * الاختبارات. والحالة عالمية أصلًا لأن العملية واحدة.
 *
 * حدود الذاكرة: كل الأسماء ثابتة عند التحميل — لا تسميات (labels)، ولا مفاتيح
 * مشتقّة من بيانات الطلب (لا userId/tripId/driverId/requestId). لذلك حجم الحالة
 * ثابت لا ينمو مع الحمل: عدّادات معدودة + مؤشّر واحد + ثلاثة histograms بسلال ثابتة.
 * أي اسم غير معرّف يُتجاهل بصمت فلا يمكن أن ينمو المخزن.
 */

/** العدّادات التراكمية المعرّفة — قائمة مغلقة. */
export const RUNTIME_COUNTERS = [
  "matching_requests_total",
  "matching_success_total",
  "matching_no_driver_total",
  "matching_error_total",
  "outbox_generated_total",
  "outbox_dedupe_skipped_total",
  "outbox_relay_cycles_total",
  "outbox_dispatch_attempted_total",
  "outbox_delivered_total",
  "outbox_failed_total",
  "outbox_retry_total",
  "outbox_dead_total",
] as const;
export type RuntimeCounterName = (typeof RUNTIME_COUNTERS)[number];

/** المؤشّرات (آخر قيمة مرصودة) — قائمة مغلقة. */
export const RUNTIME_GAUGES = ["outbox_last_batch_size"] as const;
export type RuntimeGaugeName = (typeof RUNTIME_GAUGES)[number];

/** سلال زمن المطابقة بالمللي ثانية. */
export const MATCHING_DURATION_BUCKETS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/** سلال عدد المرشّحين (توزيع، لا متوسط فقط). */
export const MATCHING_CANDIDATE_BUCKETS: readonly number[] = [
  0, 1, 2, 5, 10, 25, 50, 100, 250, 500,
];

/** سلال زمن تسليم حدث واحد من صندوق الصادر بالمللي ثانية. */
export const OUTBOX_DISPATCH_BUCKETS_MS: readonly number[] = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000,
];

export const RUNTIME_HISTOGRAM_BUCKETS = {
  matching_duration_ms: MATCHING_DURATION_BUCKETS_MS,
  matching_candidate_count: MATCHING_CANDIDATE_BUCKETS,
  outbox_dispatch_duration_ms: OUTBOX_DISPATCH_BUCKETS_MS,
} as const;
export type RuntimeHistogramName = keyof typeof RUNTIME_HISTOGRAM_BUCKETS;

export interface RuntimeHistogramState {
  count: number;
  sum: number;
  /** عدّادات تراكمية بدلالة `le` — نفس دلالة Prometheus. */
  buckets: number[];
}

export interface RuntimeHistogramSummary {
  count: number;
  sum: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface RuntimeMetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, RuntimeHistogramSummary>;
}

const HISTOGRAM_NAMES = Object.keys(
  RUNTIME_HISTOGRAM_BUCKETS,
) as RuntimeHistogramName[];

function freshHistogram(name: RuntimeHistogramName): RuntimeHistogramState {
  return {
    count: 0,
    sum: 0,
    buckets: RUNTIME_HISTOGRAM_BUCKETS[name].map(() => 0),
  };
}

const counters = new Map<RuntimeCounterName, number>(
  RUNTIME_COUNTERS.map((name) => [name, 0] as [RuntimeCounterName, number]),
);
const gauges = new Map<RuntimeGaugeName, number>(
  RUNTIME_GAUGES.map((name) => [name, 0] as [RuntimeGaugeName, number]),
);
const histograms = new Map<RuntimeHistogramName, RuntimeHistogramState>(
  HISTOGRAM_NAMES.map(
    (name) =>
      [name, freshHistogram(name)] as [
        RuntimeHistogramName,
        RuntimeHistogramState,
      ],
  ),
);

/**
 * يُشغّل عملية قياس بأفضل جهد: خلل في الرصد لا يجوز أن يُسقط عملية عمل حقيقية
 * (تسليم حدث، اختيار سائق). كل نقاط القياس في الخدمات تمرّ من هنا.
 */
export function safeMetric(operation: () => void): void {
  try {
    operation();
  } catch {
    // متجاهَل عمدًا — المقاييس ليست جزءًا من عقد العمل.
  }
}

/** يزيد عدّادًا معرّفًا. الأسماء غير المعرّفة تُتجاهل (سقف ثابت). */
export function bumpCounter(name: RuntimeCounterName, by = 1): void {
  const current = counters.get(name);
  if (current === undefined) return;
  if (!Number.isFinite(by)) return;
  counters.set(name, current + by);
}

/** يضبط مؤشّرًا معرّفًا على آخر قيمة مرصودة. */
export function setGauge(name: RuntimeGaugeName, value: number): void {
  if (!gauges.has(name)) return;
  if (!Number.isFinite(value)) return;
  gauges.set(name, value);
}

/** يسجّل مشاهدة في histogram معرّف (سلال ثابتة، بلا تخصيص ذاكرة جديد). */
export function observeHistogram(
  name: RuntimeHistogramName,
  value: number,
): void {
  const state = histograms.get(name);
  if (!state) return;
  const observed = Number.isFinite(value) ? Math.max(0, value) : 0;
  state.count += 1;
  state.sum += observed;
  const bounds = RUNTIME_HISTOGRAM_BUCKETS[name];
  for (let i = 0; i < bounds.length; i += 1) {
    if (observed <= bounds[i]) state.buckets[i] += 1;
  }
}

/** لقطة معزولة من حالة histogram (نسخ السلال). */
export function histogramState(
  name: RuntimeHistogramName,
): RuntimeHistogramState | null {
  const state = histograms.get(name);
  if (!state) return null;
  return { count: state.count, sum: state.sum, buckets: [...state.buckets] };
}

export function counterValue(name: RuntimeCounterName): number {
  return counters.get(name) ?? 0;
}

export function gaugeValue(name: RuntimeGaugeName): number {
  return gauges.get(name) ?? 0;
}

/**
 * تقدير كمّية (quantile) من الـ histogram: يعيد الحدّ الأعلى للسلّة التي تبلغها
 * الكمّية، أو `null` إن لم توجد مشاهدات أو تجاوزت آخر حد.
 */
export function estimateHistogramQuantile(
  name: RuntimeHistogramName,
  quantile: number,
): number | null {
  const state = histograms.get(name);
  if (!state || state.count === 0) return null;
  const target = quantile * state.count;
  const bounds = RUNTIME_HISTOGRAM_BUCKETS[name];
  for (let i = 0; i < bounds.length; i += 1) {
    if ((state.buckets[i] ?? 0) >= target) return bounds[i];
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function histogramSummary(
  name: RuntimeHistogramName,
): RuntimeHistogramSummary {
  const state = histograms.get(name);
  if (!state || state.count === 0) {
    return { count: 0, sum: 0, avg: null, p50: null, p95: null, p99: null };
  }
  return {
    count: state.count,
    sum: round2(state.sum),
    avg: round2(state.sum / state.count),
    p50: estimateHistogramQuantile(name, 0.5),
    p95: estimateHistogramQuantile(name, 0.95),
    p99: estimateHistogramQuantile(name, 0.99),
  };
}

/** لقطة كاملة جاهزة للعرض في نقطة JSON. */
export function runtimeMetricsSnapshot(): RuntimeMetricsSnapshot {
  const counterOut: Record<string, number> = {};
  for (const name of RUNTIME_COUNTERS) counterOut[name] = counterValue(name);
  const gaugeOut: Record<string, number> = {};
  for (const name of RUNTIME_GAUGES) gaugeOut[name] = gaugeValue(name);
  const histogramOut: Record<string, RuntimeHistogramSummary> = {};
  for (const name of HISTOGRAM_NAMES) histogramOut[name] = histogramSummary(name);
  return { counters: counterOut, gauges: gaugeOut, histograms: histogramOut };
}

/** يمسح كل الحالة — للاختبارات فقط. */
export function resetRuntimeMetrics(): void {
  for (const name of RUNTIME_COUNTERS) counters.set(name, 0);
  for (const name of RUNTIME_GAUGES) gauges.set(name, 0);
  for (const name of HISTOGRAM_NAMES) histograms.set(name, freshHistogram(name));
}

const COUNTER_HELP: Record<RuntimeCounterName, string> = {
  matching_requests_total: "Candidate selection calls",
  matching_success_total: "Candidate selection calls that returned at least one driver",
  matching_no_driver_total: "Candidate selection calls that returned no driver",
  matching_error_total: "Candidate selection calls that threw",
  outbox_generated_total: "Outbox rows successfully inserted",
  outbox_dedupe_skipped_total: "Standalone enqueues skipped by dedupeKey conflict",
  outbox_relay_cycles_total: "Relay cycles that acquired the lock and polled",
  outbox_dispatch_attempted_total: "Single-event dispatch attempts",
  outbox_delivered_total: "Dispatches that transitioned to DELIVERED",
  outbox_failed_total: "Dispatches that transitioned to FAILED",
  outbox_retry_total: "Dispatches rescheduled for a later attempt",
  outbox_dead_total: "Dispatches moved to the DLQ (DEAD)",
};

const GAUGE_HELP: Record<RuntimeGaugeName, string> = {
  outbox_last_batch_size: "Rows fetched by the most recent relay cycle",
};

const HISTOGRAM_EXPOSITION: Record<
  RuntimeHistogramName,
  { metric: string; divisor: number; help: string }
> = {
  matching_duration_ms: {
    metric: "nova_matching_duration_seconds",
    divisor: 1000,
    help: "Candidate selection latency",
  },
  matching_candidate_count: {
    metric: "nova_matching_candidate_count",
    divisor: 1,
    help: "Ranked candidate pool size per selection call",
  },
  outbox_dispatch_duration_ms: {
    metric: "nova_outbox_dispatch_duration_seconds",
    divisor: 1000,
    help: "Single outbox event dispatch latency",
  },
};

/** أسطر Prometheus للعدّادات والمؤشّرات والـ histograms. بلا تسميات متغيّرة. */
export function renderRuntimePrometheus(): string[] {
  const lines: string[] = [];

  for (const name of RUNTIME_COUNTERS) {
    const metric = `nova_${name}`;
    lines.push(
      `# HELP ${metric} ${COUNTER_HELP[name]}`,
      `# TYPE ${metric} counter`,
      `${metric} ${counterValue(name)}`,
    );
  }

  for (const name of RUNTIME_GAUGES) {
    const metric = `nova_${name}`;
    lines.push(
      `# HELP ${metric} ${GAUGE_HELP[name]}`,
      `# TYPE ${metric} gauge`,
      `${metric} ${gaugeValue(name)}`,
    );
  }

  for (const name of HISTOGRAM_NAMES) {
    const state = histograms.get(name);
    if (!state) continue;
    const meta = HISTOGRAM_EXPOSITION[name];
    const bounds = RUNTIME_HISTOGRAM_BUCKETS[name];
    lines.push(`# HELP ${meta.metric} ${meta.help}`, `# TYPE ${meta.metric} histogram`);
    for (let i = 0; i < bounds.length; i += 1) {
      lines.push(
        `${meta.metric}_bucket{le="${bounds[i] / meta.divisor}"} ${state.buckets[i] ?? 0}`,
      );
    }
    lines.push(
      `${meta.metric}_bucket{le="+Inf"} ${state.count}`,
      `${meta.metric}_sum ${round3(state.sum / meta.divisor)}`,
      `${meta.metric}_count ${state.count}`,
    );
  }

  return lines;
}
