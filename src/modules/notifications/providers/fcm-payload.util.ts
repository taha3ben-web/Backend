/**
 * أدوات نقيّة لبناء حمولة FCM HTTP v1 (قابلة للاختبار بمعزل عن Firebase SDK).
 */

/** حدّ الدفعة في sendEachForMulticast هو 500 توكن. */
export const FCM_MULTICAST_LIMIT = 500;

/** أكواد أخطاء FCM التي تعني أن التوكن لم يعد صالحًا فيجب حذفه. */
export const UNREGISTERED_ERROR_CODES: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** يقسّم مصفوفة إلى دفعات بحجم size. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * FCM HTTP v1 يشترط أن تكون كل قيم data نصوصًا. يحوّل الحقول:
 * - النصوص كما هي، الكائنات عبر JSON، غيرها عبر String().
 * - يُدرج deepLink ضمن data إن وُجد. يتجاهل null/undefined.
 */
export function buildFcmData(
  data: Record<string, unknown> | undefined,
  deepLink: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const raw: Record<string, unknown> = { ...(data ?? {}) };
  if (deepLink) raw.deepLink = deepLink;
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    out[k] =
      typeof v === "string"
        ? v
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
  }
  return out;
}

/** هل هذا كود خطأ يعني توكن غير مسجّل؟ */
export function isUnregisteredError(code: string | undefined): boolean {
  return !!code && UNREGISTERED_ERROR_CODES.has(code);
}
