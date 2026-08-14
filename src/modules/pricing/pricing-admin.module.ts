import { Module } from "@nestjs/common";
import { PricingAdminService } from "./pricing-admin.service";
import { PricingAdminController } from "./pricing-admin.controller";
import { SettingsModule } from "../settings/settings.module";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";

/**
 * إدارة التسعير من اللوحة.
 *
 * المرحلة 7: أُضيف SettingsModule (لحفظ pricing.fees) و PricingEngineModule
 * (لقراءة/تطبيع السياسة عبر PricingPolicyService نفسها التي يستخدمها المحرك،
 * حتى لا تختلف قراءة اللوحة عن القراءة المستخدمة في حساب الأجرة).
 */
@Module({
  imports: [SettingsModule, PricingEngineModule],
  providers: [PricingAdminService],
  controllers: [PricingAdminController],
  exports: [PricingAdminService],
})
export class PricingAdminModule {}
