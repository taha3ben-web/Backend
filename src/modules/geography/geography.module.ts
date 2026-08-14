import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { GeographyService } from "./geography.service";
import {
  GeographyAdminController,
  GeographyPublicController,
} from "./geography.controller";

/**
 * المرحلة 8 — وحدة الجغرافيا (الولايات الجزائرية ومدنها).
 *
 * لماذا وحدة منفصلة وليست داخل SettingsModule:
 * الجغرافيا يعتمد عليها التسعير والسائقون والتطبيقات، وليست إعدادًا من
 * إعدادات التطبيق. وحدة مستقلة تجعل التبعية صريحة.
 *
 * SettingsModule مستوردة من أجل ConfigVersionService فقط (رفع إصدار الإعدادات
 * حتى تُعيد التطبيقات جلب قائمة الولايات/المدن بعد أي تعديل إداري).
 *
 * لا توجد هنا أي عملية حساب مسافة أو مدة — ذلك دور GeoModule/Google Routes.
 */
@Module({
  imports: [SettingsModule],
  providers: [GeographyService],
  controllers: [GeographyAdminController, GeographyPublicController],
  exports: [GeographyService],
})
export class GeographyModule {}
