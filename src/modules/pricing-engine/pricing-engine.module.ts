import { Module } from "@nestjs/common";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingEngineController } from "./pricing-engine.controller";

/**
 * محرك التسعير المستقل (Pricing Engine). مستقل عن المطابقة،
 * ويُصدّر الخدمة لتُستخدم في أي وحدة.
 */
@Module({
  providers: [PricingEngineService],
  controllers: [PricingEngineController],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}
