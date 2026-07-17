import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentsService } from "./payments.service";

@Controller("payments/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * استقبال webhook من مزوّد دفع.
   *
   * طبقتا حماية:
   * 1) توقيع HMAC-SHA256 (موصى به): إذا ضُبط السر `PAYMENT_WEBHOOK_SECRET`
   *    يرفض أي طلب بلا توقيع صحيح في ترويسة `x-webhook-signature`.
   * 2) توكن مشترك (توافق خلفي): `x-webhook-token` مقابل `PAYMENT_WEBHOOK_TOKEN`.
   *
   * ملاحظة: للتحقّق الأمثل يجب حساب التوقيع على الجسم الخام (raw body)؛
   * يجب تفعيل rawBody في bootstrap (`NestFactory.create(App, { rawBody: true })`)
   * واستخدام `@Req()` لقراءة `req.rawBody`. هنا نوقّع الحمولة المُفكّكة
   * بشكل قانوني (canonical JSON) كحد أدنى آمن.
   */
  @Post(":provider")
  receive(
    @Param("provider") provider: string,
    @Body() payload: Record<string, unknown>,
    @Headers("x-webhook-token") token?: string,
    @Headers("x-webhook-signature") signature?: string,
    @Headers("x-webhook-id") eventId?: string,
  ) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
    const expectedToken = process.env.PAYMENT_WEBHOOK_TOKEN?.trim();

    // في الإنتاج: يجب ضبط التوقيع أو التوكن على الأقل.
    if (!secret && !expectedToken && process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException(
        "Webhook protection is not configured",
      );
    }

    if (secret) {
      if (!this.verifySignature(secret, payload, signature)) {
        throw new UnauthorizedException("Webhook signature غير صالح");
      }
    }

    if (expectedToken && token?.trim() !== expectedToken) {
      throw new UnauthorizedException("Webhook token غير صالح");
    }

    return this.payments.processWebhook(provider, payload, eventId);
  }

  private verifySignature(
    secret: string,
    payload: Record<string, unknown>,
    signature?: string,
  ): boolean {
    if (!signature) return false;
    const canonical = JSON.stringify(payload ?? {});
    const expected = createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");
    // تطبيع التوقيع الوارد (يقبل صيغة "sha256=..." أو hex مجرّد).
    const provided = signature.trim().replace(/^sha256=/i, "");
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
