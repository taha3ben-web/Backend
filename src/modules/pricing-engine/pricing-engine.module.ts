import { Module } from "@nestjs/common";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingEngineController } from "./pricing-engine.controller";
import { SurgeService } from "./surge.service";
import { SurgeController } from "./surge.controller";
import { CountryConfigModule } from "../country-config/country-config.module";
import { CityScalingModule } from "../city-scaling/city-scaling.module";
import { GrowthModule } from "../growth/growth.module";
import { GeoModule } from "../geo/geo.module";

/**
 * محرك التسعير المستقل (Pricing Engine). مستقل عن المطابقة،
 * ويُصدّر الخدمة لتُستخدم في أي وحدة.
 * يضمّ أيضًا التسعير الديناميكي الحيّ (SurgeService) الذي يرفع/يخفض السعر
 * حسب نسبة الطلب إلى العرض لحظة الطلب.
 */
@Module({
  imports: [CountryConfigModule, CityScalingModule, GrowthModule, GeoModule],
  providers: [PricingEngineService, SurgeService],
  controllers: [PricingEngineController, SurgeController],
  exports: [PricingEngineService, SurgeService],
})
export class PricingEngineModule {}
