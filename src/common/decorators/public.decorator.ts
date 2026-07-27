import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * يفتح المسار للعموم (بلا مصادقة).
 *
 * السياسة الأمنية للمشروع: **كل المسارات محمية افتراضيًا** عبر حارس عالمي
 * (`APP_GUARD` في `app.module.ts`)، ولا يُفتح مسار إلا بوضع هذا المزيّن عليه
 * صراحةً. أي مسار جديد يُكتب مستقبلًا يكون محميًا تلقائيًا دون تدخل.
 *
 * يُسمح باستخدامه فقط في: المصادقة (login/register/otp/refresh)، الفحص الصحي،
 * webhooks المزوّدين (محمية بتوقيع)، المقاييس (محمية بتوكن)، والمحتوى القانوني
 * العام.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
