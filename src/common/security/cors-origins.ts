/**
 * مصدر موحّد لإعدادات CORS عبر HTTP و WebSocket (منع التكرار).
 *
 * القاعدة:
 * - عند ضبط CORS_ORIGINS (قائمة مفصولة بفواصل): نسمح بهذه الأصول فقط
 *   مع الاعتمادات (credentials).
 * - عند غيابها في الإنتاج: نرفض أي أصل عابر (origin=false) كدفاع مزدوج
 *   (الإقلاع نفسه يُمنع في main.ts عند غياب CORS_ORIGINS في الإنتاج).
 * - عند غيابها في التطوير: نسمح للجميع (*) دون اعتمادات لتسهيل التطوير.
 */
export interface CorsResult {
  origin: string | string[] | boolean;
  credentials: boolean;
}

/** يحلّل CORS_ORIGINS إلى قائمة أصول منظّفة (يتجاهل الفراغات والمدخلات الفارغة). */
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * يحسب إعدادات CORS الموحّدة لـ HTTP و WebSocket.
 */
export function resolveCorsOptions(
  raw: string | undefined,
  isProd: boolean,
): CorsResult {
  const origins = parseCorsOrigins(raw);
  if (origins.length) {
    return { origin: origins, credentials: true };
  }
  // لا قائمة أصول
  if (isProd) {
    // دفاع مزدوج: لا نسمح بأي أصل عابر في الإنتاج.
    return { origin: false, credentials: false };
  }
  return { origin: "*", credentials: false };
}
