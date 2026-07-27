import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { PaymentsService } from "./payments.service";
import { Public } from "../../common/decorators/public.decorator";
import {
  readChargilyConfig,
  verifyChargilySignature,
} from "./providers/chargily.adapter";

type RawBodyRequest = Request & { rawBody?: Buffer };

// مسار عام مقصود: مزوّد الدفع لا يملك JWT؛ الحماية بالتوقيع والتوكن.
@Public()
@Controller("payments/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * استقبال webhook من مزوّد دفع.
   *
   * طبقتا حماية:
   * 1) توقيع HMAC-SHA256 محسوب على **الجسم الخام** (`req.rawBody` المحفوز
   *    في `main.ts` عبر `json({ verify })`). لا يُقبل أي بديل في الإنتاج.
   * 2) توكن مشترك (توافق خلفي): `x-webhook-token` مقابل `PAYMENT_WEBHOOK_TOKEN`.
   *
   * لماذا الجسم الخام إلزامي: توقيع محسوب على JSON مُعاد التسلسل يختلف عن
   * توقيع المزوّد (ترتيب المفاتيح، المسافات، تمثيل الأرقام وUnicode)، فيفتح باب
   * قبول حمولات متلاعب بها أو رفض حمولات صحيحة.
   */
  @Post(":provider")
  receive(
    @Param("provider") provider: string,
    @Body() payload: Record<string, unknown>,
    @Req() req: RawBodyRequest,
    @Headers("x-webhook-token") token?: string,
    @Headers("x-webhook-signature") signature?: string,
    @Headers("x-webhook-id") eventId?: string,
    @Headers("signature") providerSignature?: string,
  ) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
    const expectedToken = process.env.PAYMENT_WEBHOOK_TOKEN?.trim();
    const isProd = process.env.NODE_ENV === "production";

    // مسار Chargily: يوقّع بمفتاحه السرّي في ترويسة `signature`،
    // وليس بمفتاحنا المشترك، لذلك له فرع خاص قبل التحقق العام.
    if (provider.trim().toLowerCase() === "chargily") {
      const chargily = readChargilyConfig();
      if (!chargily) {
        throw new ServiceUnavailableException(
          "Chargily webhook is not configured",
        );
      }
      const raw = req.rawBody;
      if (!raw?.length) {
        throw new ServiceUnavailableException(
          "Raw body unavailable for webhook signature verification",
        );
      }
      const ok = verifyChargilySignature({
        secretKey: chargily.secretKey,
        rawBody: raw,
        signature: providerSignature ?? signature,
      });
      if (!ok) {
        throw new UnauthorizedException("Webhook signature غير صالح");
      }
      return this.payments.processWebhook("chargily", payload, eventId);
    }

    // في الإنتاج: يجب ضبط التوقيع أو التوكن على الأقل.
    if (!secret && !expectedToken && isProd) {
      throw new ServiceUnavailableException(
        "Webhook protection is not configured",
      );
    }

    if (secret) {
      const raw = req.rawBody;
      if (!raw?.length) {
        // لا نقبل أبدًا التوقيع على حمولة مُعاد تسلسلها.
        throw new ServiceUnavailableException(
          "Raw body unavailable for webhook signature verification",
        );
      }
      if (!this.verifySignature(secret, raw, signature)) {
        throw new UnauthorizedException("Webhook signature غير صالح");
      }
    }

    if (expectedToken && !this.safeEqualStrings(token?.trim(), expectedToken)) {
      throw new UnauthorizedException("Webhook token غير صالح");
    }

    return this.payments.processWebhook(provider, payload, eventId);
  }

  /** تحقق HMAC-SHA256 على البايتات الخام، بمقارنة ثابتة الزمن. */
  private verifySignature(
    secret: string,
    rawBody: Buffer,
    signature?: string,
  ): boolean {
    if (!signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    // تطبيع التوقيع الوارد (يقبل صيغة "sha256=..." أو hex مجرد).
    const provided = signature.trim().replace(/^sha256=/i, "");
    if (!/^[0-9a-f]+$/i.test(provided)) return false;
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  /** مقارنة نصية ثابتة الزمن (تمنع استنتاج التوكن من فروق التوقيت). */
  private safeEqualStrings(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
