import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { CallMaskingService } from "./call-masking.service";
import {
  buildDialTwiml,
  buildRejectTwiml,
  verifyTwilioSignature,
} from "./call-masking.adapter";

/**
 * webhook المكالمات الواردة من Twilio.
 *
 * مسار عام مقصود: Twilio لا يملك JWT. الحماية بتوقيع `X-Twilio-Signature`
 * المحسوب على (الرابط الكامل + حقول النموج مرتّبة)، وهو توقيع لا يمكن
 * تزويره دون `TWILIO_AUTH_TOKEN`.
 *
 * لماذا لا نقبل أبدًا بلا توقيع: من يطرق هذا المسار يستطيع جعل المنصة
 * تتصل بأي رقم على حسابنا (تكلفة مالية مباشرة) وأن يكشف ربط الأرقام.
 */
@Public()
@Controller("calls/twilio")
export class TwilioVoiceController {
  private readonly logger = new Logger("TwilioVoice");

  constructor(private readonly calls: CallMaskingService) {}

  @Post("voice")
  @HttpCode(200)
  @Header("Content-Type", "text/xml; charset=utf-8")
  async voice(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Headers("x-twilio-signature") signature?: string,
  ): Promise<string> {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) {
      throw new ServiceUnavailableException("TWILIO_NOT_CONFIGURED");
    }

    const url = this.absoluteUrl(req);
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      params[key] = String(value ?? "");
    }
    if (!verifyTwilioSignature({ authToken, url, params, signature })) {
      this.logger.warn(`توقيع Twilio غير صالح للرابط ${url}`);
      throw new UnauthorizedException("INVALID_TWILIO_SIGNATURE");
    }

    const to = String(body?.To ?? "").trim();
    const from = String(body?.From ?? "").trim();
    if (!to || !from) {
      return buildRejectTwiml("تعذر إتمام المكالمة. حاول من داخل التطبيق.");
    }

    const routing = await this.calls.resolveInbound(to, from);
    if (!routing) {
      // لا نكشف السبب: رقم غير مسجل، أو ربط منتهٍ، أو رحلة منتهية.
      return buildRejectTwiml(
        "هذا الرقم غير متاح للاتصال حاليًا. افتح التطبيق واطلب الاتصال من صفحة الرحلة.",
      );
    }

    this.logger.log(
      `تحويل مكالمة للرحلة ${routing.tripId} (جلسة ${routing.sessionId})`,
    );
    return buildDialTwiml({
      target: routing.target,
      callerId: routing.callerId,
      timeoutSec: Number(process.env.TWILIO_DIAL_TIMEOUT_SEC ?? 30),
      recordingEnabled:
        String(process.env.TWILIO_RECORD_CALLS ?? "").toLowerCase() === "true",
    });
  }

  /**
   * الرابط الكامل كما رآه Twilio. يجب أن يطابق المضبوط في لوحة Twilio
   * حرفًا بحرف، وإلا فشل التوقيع. وراء وكيل عكسي اضبط `TWILIO_WEBHOOK_BASE_URL`.
   */
  private absoluteUrl(req: Request): string {
    const base = process.env.TWILIO_WEBHOOK_BASE_URL?.trim();
    if (base) {
      return `${base.replace(/\/+$/, "")}${req.originalUrl}`;
    }
    const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol);
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host);
    return `${proto}://${host}${req.originalUrl}`;
  }
}
