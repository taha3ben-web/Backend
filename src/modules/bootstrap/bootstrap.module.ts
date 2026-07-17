import { Module } from "@nestjs/common";
import { AppVersionsModule } from "../app-versions/app-versions.module";
import { SettingsModule } from "../settings/settings.module";
import { FeatureFlagsModule } from "../settings/feature-flags.module";
import { LegalModule } from "../legal/legal.module";
import { VehicleTypesModule } from "../vehicle-types/vehicle-types.module";
import { EmergencyModule } from "../emergency/emergency.module";
import { GeoModule } from "../geo/geo.module";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapController } from "./bootstrap.controller";
import { BootstrapAdminController } from "./bootstrap-admin.controller";

/**
 * وحدة التهيئة الموحّدة (Client Bootstrap).
 * تجمع مصادر الحقيقة القائمة (دون تكرار منطقها) في استدعاء واحد:
 * - AppVersionsModule: سياسة الإصدار.
 * - SettingsModule: الإعدادات العامة + رقم إصدار الإعدادات.
 * - FeatureFlagsModule: تقييم مفاتيح الميزات.
 * - LegalModule: المستندات القانونية + الموافقات المعلّقة.
 * - VehicleTypesModule: الكتالوج العام.
 * - EmergencyModule: جهات الطوارئ.
 * - GeoModule: إعداد الخرائط العام + الأماكن المحفوظة.
 */
@Module({
  imports: [
    AppVersionsModule,
    SettingsModule,
    FeatureFlagsModule,
    LegalModule,
    VehicleTypesModule,
    EmergencyModule,
    GeoModule,
  ],
  providers: [BootstrapService],
  controllers: [BootstrapController, BootstrapAdminController],
  exports: [BootstrapService],
})
export class BootstrapModule {}
