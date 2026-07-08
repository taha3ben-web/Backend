import { Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { CitiesService } from "./cities.service";
import { ZonesService } from "./zones.service";
import { SettingsController } from "./settings.controller";
import { CitiesController } from "./cities.controller";
import { ZonesController } from "./zones.controller";

/**
 * وحدة الإعدادات والمدن والمناطق.
 * - إعدادات التطبيق (key/value JSON): الاسم، الشعار، الألوان، اللغات،
 *   العملة، الخصوصية، الشروط، Firebase، الخرائط، الإشعارات، البريد، الرسائل.
 * - المدن (CRUD) والمناطق (Zones مع polygon).
 * SettingsService مُصدّرة لاستخدامها من وحدات أخرى.
 */
@Module({
  providers: [SettingsService, CitiesService, ZonesService],
  controllers: [SettingsController, CitiesController, ZonesController],
  exports: [SettingsService],
})
export class SettingsModule {}
