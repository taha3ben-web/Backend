import { Module } from "@nestjs/common";
import { SettingsModule } from "./settings.module";
import { FeatureFlagsService } from "./feature-flags.service";
import { FeatureFlagsController } from "./feature-flags.controller";

/**
 * وحدة مفاتيح الميزات (Feature Flags).
 * - تربط controller/service اللذين لم يكونا مسجّلين في أي وحدة سابقًا.
 * - تستورد SettingsModule للحصول على ConfigVersionService (لرفع رقم إصدار الإعدادات).
 * - تُصدّر FeatureFlagsService لاستخدامه في Bootstrap وغيره.
 */
@Module({
  imports: [SettingsModule],
  providers: [FeatureFlagsService],
  controllers: [FeatureFlagsController],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
