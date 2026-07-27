/**
 * دوال نقيّة لذاكرة تخزين الإعدادات ومفاتيح الميزات.
 * لا تعتمد على Redis ولا Nest — قابلة للاختبار مباشرة.
 */

export const CONFIG_CACHE_PREFIX = "cfg";
/** مدة الطبقة المحلية داخل العملية (ملّي ثانية). */
export const LOCAL_TIER_TTL_MS = 5_000;
/** مدة طبقة Redis الافتراضية (ثانية). */
export const DEFAULT_REDIS_TTL_SEC = 60;
/** قناة إلغاء الصلاحية بين نسخ الخادم. */
export const CONFIG_INVALIDATE_CHANNEL = "cfg:invalidate";

/** يبني مفتاح ذاكرة موحّدًا: cfg:public-config:0 */
export function cacheKey(namespace: string, suffix?: string): string {
  const tail = suffix ? `:${suffix}` : "";
  return `${CONFIG_CACHE_PREFIX}:${namespace}${tail}`;
}

/**
 * يولّد بصمة ثابتة لكائن سياق مهما اختلف ترتيب المفاتيح.
 * مهمّ: دون الترتيب الثابت ينتج مفتاحان مختلفان لنفس السياق فتضيع الفائدة.
 */
export function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortValue(v);
    return out;
  }
  return value;
}

/** يقرأ مدة التخزين من البيئة مع حدود عاقلة (1..3600 ثانية). */
export function cacheTtlFromEnv(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_REDIS_TTL_SEC;
  return Math.min(3600, Math.max(1, Math.trunc(n)));
}

/** هل انتهت صلاحية مدخلة محلية؟ */
export function isExpired(
  expiresAt: number,
  now: number = Date.now(),
): boolean {
  return expiresAt <= now;
}

/** هل يطابق المفتاح نمط إلغاء الصلاحية (دعم * في النهاية فقط)؟ */
export function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return key.startsWith(pattern.slice(0, -1));
  return key === pattern;
}
