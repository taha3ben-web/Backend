import { Module } from "@nestjs/common";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingEngineController } from "./pricing-engine.controller";
import { CountryConfigModule } from "../country-config/country-config.module";
import { CityScalingModule } from "../city-scaling/city-scaling.module";
import { GrowthModule } from "../growth/growth.module";

/**
 * محرك التسعير المستقل (Pricing Engine). مستقل عن المطابقة،
 * ويُصدّر الخدمة لتُستخدم في أي وحدة.
 */
@Module({
  imports: [CountryConfigModule, CityScalingModule, GrowthModule],
  providers: [PricingEngineService],
  controllers: [PricingEngineController],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}
