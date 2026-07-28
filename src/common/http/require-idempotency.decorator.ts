import { SetMetadata } from "@nestjs/common";

/** مفتاح الوسم الذي يقرأه المعترض عبر Reflector. */
export const IDEMPOTENCY_REQUIRED = "idempotency:required";

/**
 * يعلّم مسارًا (أو متحكّمًا كاملًا) بأنه عملية مالية/حسّاسة يجب أن
 * تحمل ترويسة `Idempotency-Key` لمنع الازدواج عند إعادة الإرسال أو تكرار الشبكة.
 *
 * الإلزام الفعلي (رفض 400 عند غياب الترويسة) يُفعّل فقط عندما يكون
 * `IDEMPOTENCY_ENFORCE=true`، حتى لا نكسر عملاء لم يُحدّثوا بعد لإرسال المفتاح.
 * بدون التفعيل يبقى السلوك تمريرًا آمنًا (ومع ذلك يُلغى الازدواج إذا وُجد المفتاح).
 */
export const RequireIdempotency = () =>
  SetMetadata(IDEMPOTENCY_REQUIRED, true);
