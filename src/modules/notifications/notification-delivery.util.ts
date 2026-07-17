/**
 * منطق نقي لتسليم الإشعارات الدائم (durable delivery) — قابل للاختبار دون قاعدة
 * بيانات أو Nest. يحدّد متى تُعتبر محاولة التسليم ناجحة، ونافذة الحجز (visibility
 * timeout) التي تمنع معالجة نفس الإشعار من عدة نسخ خادم في آنٍ واحد.
 *
 * سياسة إعادة المحاولة نفسها (تراجع أسّي + DLQ) مُعاد استخدامها من
 * `common/infra/outbox.util.ts` عبر `nextOutboxState` — بلا تكرار.
 */

/** نافذة حجز السجل أثناء محاولة التسليم (مهلة رؤية). */
export const NOTIFICATION_CLAIM_WINDOW_MS = 2 * 60 * 1_000;

/** الحد الأقصى لمحاولات تسليم الإشعار قبل الانتقال إلى DLQ. */
export const NOTIFICATION_MAX_ATTEMPTS = 8;

/** نتيجة محاولة تسليم واحدة كما يرصدها المُسلِّم. */
export interface DeliveryAttempt {
  /** هل أُطلق استثناء أثناء التسليم (خطأ في قاعدة البيانات أو المزوّد)؟ */
  threw: boolean;
  /** عدد المستلمين المستهدفين بعد حلّ الجمهور. */
  recipientCount: number;
  /** عدد الرسائل التي أكّد المزوّد إرسالها. */
  sentCount: number;
}

/**
 * تُعتبر المحاولة ناجحة عندما:
 * - لم يُطلق استثناء، و
 * - لا يوجد جمهور أصلًا (لا شيء لإرساله) أو وصلت رسالة واحدة على الأقل.
 *
 * الفشل الكلّي (جمهور غير فارغ لكن صفر تسليم) يُعامَل كفشل عابر قابل لإعادة
 * المحاولة، لأن السبب الغالب انقطاع المزوّد أو رفض عابر لكل الرموز/الأرقام.
 */
export function isDeliverySuccessful(attempt: DeliveryAttempt): boolean {
  if (attempt.threw) return false;
  if (attempt.recipientCount === 0) return true;
  return attempt.sentCount >= 1;
}

/**
 * يبني سبب الفشل المختصر المخزَّن في `lastError` عند فشل عابر بلا استثناء
 * (فشل كلّي في التسليم).
 */
export function zeroDeliveryError(recipientCount: number): string {
  return `تعذّر تسليم الإشعار إلى أيٍّ من ${recipientCount} مستلم (فشل مزوّد محتمل)`;
}
