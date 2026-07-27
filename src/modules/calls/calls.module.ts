import { Module } from "@nestjs/common";
import { CallMaskingService } from "./call-masking.service";
import { CallMaskingController } from "./call-masking.controller";
import { TwilioVoiceController } from "./twilio-voice.controller";

/**
 * وحدة إخفاء أرقام الهواتف بين الراكب والسائق.
 * محول افتراضي "دردشة فقط" يعمل اليوم، ومحول Twilio منجّز بالكامل
 * يُفعّل بـ CALL_MASKING_PROVIDER=twilio دون لمس منطق الرحلات.
 */
@Module({
  providers: [CallMaskingService],
  controllers: [CallMaskingController, TwilioVoiceController],
  exports: [CallMaskingService],
})
export class CallsModule {}
