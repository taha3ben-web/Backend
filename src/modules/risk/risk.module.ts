import { Module } from "@nestjs/common";
import { RiskService } from "./risk.service";
import { RiskController } from "./risk.controller";

/**
 * وحدة المخاطر والاحتيال (Fraud & Risk): حدود سرعة، تسجيل شذوذ، قائمة
 * حظر، طابور مراجعة، وحجز يدوي. تصدّر `RiskService` لتستهلكها مسارات
 * المالية/الدفع/السحب قبل تنفيذ العمليات الحساسة.
 */
@Module({
  providers: [RiskService],
  controllers: [RiskController],
  exports: [RiskService],
})
export class RiskModule {}
