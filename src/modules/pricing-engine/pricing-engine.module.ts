import { Module } from "@nestjs/common";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingPolicyService } from "./pricing-policy.service";
import { SettingsModule } from "../settings/settings.module";
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
 *
 * المرحلة 7: أُضيفت PricingPolicyService لقراءة رسوم الخدمة/الانتظار/الإلغاء
 * من إعدادات اللوحة (SettingsModule)، وهي قارئ إعدادات فقط وليست محرك تسعير ثانيًا.
 */
@Module({
  imports: [
    CountryConfigModule,
    CityScalingModule,
    GrowthModule,
    GeoModule,
    SettingsModule,
  ],
  providers: [PricingEngineService, SurgeService, PricingPolicyService],
  controllers: [PricingEngineController, SurgeController],
  exports: [PricingEngineService, SurgeService, PricingPolicyService],
})
export class PricingEngineModule {}
