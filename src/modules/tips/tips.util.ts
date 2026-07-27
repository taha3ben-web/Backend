/**
 * دوال نقيّة لإكراميات السائقين — بلا Prisma ولا Nest لتبقى قابلة للاختبار.
 */

/** المدة المسموحة لإرسال إكرامية بعد اكتمال الرحلة. */
export const TIP_WINDOW_HOURS = 72;
/** أقل وأكبر إكرامية مقبولة (بالعملة الأساسية). */
export const TIP_MIN_AMOUNT = 20;
export const TIP_MAX_AMOUNT = 5000;
/** المبالغ المقترحة في التطبيق. */
export const TIP_PRESETS = [50, 100, 200, 500];
/** أقصى طول لرسالة الشكر المرفقة. */
export const TIP_NOTE_MAX_LENGTH = 200;

export type TipRejection =
  | "NOT_COMPLETED"
  | "WINDOW_EXPIRED"
  | "AMOUNT_TOO_SMALL"
  | "AMOUNT_TOO_LARGE"
  | "AMOUNT_INVALID";

/** مفتاح خمول التكرار لقيد الإكرامية — واحد لكل رحلة. */
export function tipIdempotencyKey(tripId: string): string {
  return `trip:tip:${tripId}`;
}

/** يتحقق من المبلغ: رقم موجب بخانتين عشريتين داخل الحدود. */
export function validateTipAmount(amount: number): TipRejection | null {
  if (!Number.isFinite(amount) || amount <= 0) return "AMOUNT_INVALID";
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(0)))
    return "AMOUNT_INVALID";
  if (amount < TIP_MIN_AMOUNT) return "AMOUNT_TOO_SMALL";
  if (amount > TIP_MAX_AMOUNT) return "AMOUNT_TOO_LARGE";
  return null;
}

/** هل ما زالت نافذة الإكرامية مفتوحة؟ */
export function isWithinTipWindow(
  completedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!completedAt) return false;
  const elapsedMs = now.getTime() - completedAt.getTime();
  if (elapsedMs < 0) return true;
  return elapsedMs <= TIP_WINDOW_HOURS * 3600 * 1000;
}

/** رسالة عربية مفهومة لكل سبب رفض. */
export function tipRejectionMessage(reason: TipRejection): string {
  switch (reason) {
    case "NOT_COMPLETED":
      return "يمكن إرسال الإكرامية بعد اكتمال الرحلة فقط";
    case "WINDOW_EXPIRED":
      return `انتهت مدة إرسال الإكرامية (${TIP_WINDOW_HOURS} ساعة)`;
    case "AMOUNT_TOO_SMALL":
      return `أقل إكرامية هي ${TIP_MIN_AMOUNT}`;
    case "AMOUNT_TOO_LARGE":
      return `أقصى إكرامية هي ${TIP_MAX_AMOUNT}`;
    default:
      return "مبلغ الإكرامية غير صالح";
  }
}
