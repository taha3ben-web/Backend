/**
 * منطق نقي لسجلّ مزوّدي الدفع (PSP) ورصد صحّة الـ Webhooks — قابل للاختبار
 * دون قاعدة بيانات أو شبكة. لا يستورد @prisma/client (يستخدم سلاسل نصّية
 * للطرق) حتّى يبقى مستقلًّا تمامًا. يعمل فوق البنية القائمة (لا يكرّر
 * تدفّق checkout/webhook الحرج). لا يحتوي أي منطق تسعير أو خصم.
 */

export type PaymentMethodKey = "CASH" | "CARD" | "WALLET";

export type SignatureScheme =
  | "hmac_sha256_hex"
  | "hmac_sha256_base64"
  | "none";

export interface GatewayCapabilities {
  checkout: boolean;
  capture: boolean;
  refund: boolean;
  cancel: boolean;
}

export interface GatewayProvider {
  key: string;
  label: string;
  enabled: boolean;
  /** طرق الدفع التي يخدمها المزوّد. */
  methods: PaymentMethodKey[];
  /** هل يستقبل webhooks (مزوّدو البطاقات فقط). */
  webhookDriven: boolean;
  signatureScheme: SignatureScheme;
  /** هل ضُبط سرّ أو توكن حماية للـ webhook (دون كشف قيمته). */
  protectionConfigured: boolean;
  capabilities: GatewayCapabilities;
}

interface BaseProviderSpec {
  key: string;
  label: string;
  methods: PaymentMethodKey[];
  webhookDriven: boolean;
  capabilities: GatewayCapabilities;
}

/**
 * المزوّدون الأساسيون المدمجون. cash/wallet داخليّان بلا webhook.
 * مزوّدو البطاقات لا يظهرون إلا عند تعريفهم صراحة في البيئة، ولا يعني
 * ظهورهم اكتمال محوّل checkout الخاص بهم.
 */
export const BASE_PROVIDERS: readonly BaseProviderSpec[] = [
  {
    key: "cash",
    label: "الدفع النقدي",
    methods: ["CASH"],
    webhookDriven: false,
    capabilities: { checkout: false, capture: false, refund: false, cancel: false },
  },
  {
    key: "wallet",
    label: "المحفظة الداخلية",
    methods: ["WALLET"],
    webhookDriven: false,
    capabilities: { checkout: false, capture: false, refund: true, cancel: true },
  },
];

/** يحوّل قيمة مخطّط التوقيع الواردة إلى قيمة معتمدة (الافتراضي hex). */
export function normalizeSignatureScheme(value?: string): SignatureScheme {
  const v = value?.trim().toLowerCase();
  if (v === "hmac_sha256_base64" || v === "base64") return "hmac_sha256_base64";
  if (v === "none") return "none";
  return "hmac_sha256_hex";
}

/** يحلّل قائمة مزوّدين مفصولة بفواصل من البيئة، مع تطبيع وإزالة التكرار. */
export function parseProviderList(value?: string): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(",")) {
    const key = part.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

type EnvMap = Record<string, string | undefined>;

function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * يبني سجلّ المزوّدين من المزوّدين الأساسيين + مزوّدي البطاقات الإضافيين
 * المعرّفين عبر PAYMENT_PROVIDERS. حماية الـ webhook (السرّ/التوكن) عامّة.
 */
export function resolveGatewayProviders(env: EnvMap): GatewayProvider[] {
  const scheme = normalizeSignatureScheme(env.PAYMENT_WEBHOOK_SCHEME);
  const protection =
    isConfigured(env.PAYMENT_WEBHOOK_SECRET) ||
    isConfigured(env.PAYMENT_WEBHOOK_TOKEN);

  const providers: GatewayProvider[] = BASE_PROVIDERS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    enabled: true,
    methods: [...spec.methods],
    webhookDriven: spec.webhookDriven,
    signatureScheme: spec.webhookDriven ? scheme : "none",
    protectionConfigured: spec.webhookDriven ? protection : false,
    capabilities: { ...spec.capabilities },
  }));

  const known = new Set(providers.map((p) => p.key));
  for (const key of parseProviderList(env.PAYMENT_PROVIDERS)) {
    if (known.has(key)) continue;
    known.add(key);
    providers.push({
      key,
      label: key,
      enabled: true,
      methods: ["CARD"],
      webhookDriven: true,
      signatureScheme: scheme,
      protectionConfigured: protection,
      capabilities: { checkout: true, capture: true, refund: true, cancel: true },
    });
  }

  return providers;
}

/** يعدّ مزوّدي البطاقات المُفعّلين الذين يستقبلون webhooks. */
export function countWebhookProviders(providers: GatewayProvider[]): number {
  return providers.filter((p) => p.enabled && p.webhookDriven).length;
}

/** هل توجد حماية webhook مضبوطة لأي مزوّد يقوده webhook. */
export function isProtectionConfigured(providers: GatewayProvider[]): boolean {
  return providers.some((p) => p.webhookDriven && p.protectionConfigured);
}

export type HealthSeverity = "healthy" | "warning" | "critical";

export interface WebhookHealthThresholds {
  /** نسبة الفشل التي ترفع إلى تحذير. */
  failWarnRatio: number;
  /** نسبة الفشل التي ترفع إلى حرِجة. */
  failCritRatio: number;
  /** أدنى عدد أحداث قبل اعتبار النسبة ذات دلالة. */
  minSample: number;
  /** تقادم آخر حدث (مللي ثانية) الذي يُعتبر عنده المسار راكدًا. */
  staleMs: number;
}

export const DEFAULT_WEBHOOK_HEALTH_THRESHOLDS: WebhookHealthThresholds = {
  failWarnRatio: 0.1,
  failCritRatio: 0.5,
  minSample: 10,
  staleMs: 24 * 60 * 60 * 1_000,
};

export interface WebhookHealthInput {
  totalEvents: number;
  failedEvents: number;
  lastEventAgeMs: number | null;
  webhookProviders: number;
  protectionConfigured: boolean;
}

export interface WebhookHealth {
  severity: HealthSeverity;
  failureRatio: number;
  totalEvents: number;
  failedEvents: number;
  protectionConfigured: boolean;
  unprotected: boolean;
  stale: boolean;
  recommendations: string[];
}

/** نسبة الأحداث الفاشلة إلى الإجمالي (0 إذا لا أحداث). */
export function computeFailureRatio(failed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, failed / total));
}

const RANK: Record<HealthSeverity, number> = {
  healthy: 0,
  warning: 1,
  critical: 2,
};

function escalate(a: HealthSeverity, b: HealthSeverity): HealthSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * يشتقّ صحّة مسار الـ webhooks: يعتبر الثغرة الأمنية (مزوّد بطاقات مُفعّل
 * دون حماية) حرِجة، ثمّ نسبة الفشل والركود.
 */
export function classifyWebhookHealth(
  input: WebhookHealthInput,
  thresholds: WebhookHealthThresholds = DEFAULT_WEBHOOK_HEALTH_THRESHOLDS,
): WebhookHealth {
  const t = thresholds;
  const failureRatio = computeFailureRatio(input.failedEvents, input.totalEvents);
  const unprotected = input.webhookProviders > 0 && !input.protectionConfigured;
  const stale =
    input.webhookProviders > 0 &&
    input.lastEventAgeMs !== null &&
    input.lastEventAgeMs >= t.staleMs;

  let severity: HealthSeverity = "healthy";
  if (unprotected) severity = escalate(severity, "critical");
  if (
    input.totalEvents >= t.minSample &&
    failureRatio >= t.failCritRatio
  ) {
    severity = escalate(severity, "critical");
  } else if (failureRatio >= t.failWarnRatio && input.failedEvents > 0) {
    severity = escalate(severity, "warning");
  }
  if (stale) severity = escalate(severity, "warning");

  const recommendations: string[] = [];
  if (unprotected) {
    recommendations.push(
      "مزوّد بطاقات مُفعّل دون حماية webhook — اضبط PAYMENT_WEBHOOK_SECRET أو PAYMENT_WEBHOOK_TOKEN.",
    );
  }
  if (failureRatio >= t.failWarnRatio && input.failedEvents > 0) {
    recommendations.push(
      "نسبة فشل أحداث الدفع مرتفعة — راجع سجلّ الأحداث الأخيرة.",
    );
  }
  if (stale) {
    recommendations.push(
      "لم تصل أحداث webhook منذ مدّة — تحقّق من إعداد المزوّد والاتّصال.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push("مسار الـ webhooks سليم — لا إجراء مطلوب.");
  }

  return {
    severity,
    failureRatio,
    totalEvents: input.totalEvents,
    failedEvents: input.failedEvents,
    protectionConfigured: input.protectionConfigured,
    unprotected,
    stale,
    recommendations,
  };
}
