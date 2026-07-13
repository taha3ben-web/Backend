import { Module } from "@nestjs/common";
import { SettingsService } from "./settings.service";
import { CitiesService } from "./cities.service";
import { ZonesService } from "./zones.service";
import {
  PublicSettingsController,
  SettingsController,
} from "./settings.controller";
import { ConfigVersionService } from "./config-version.service";
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
  providers: [
    ConfigVersionService,
    SettingsService,
    CitiesService,
    ZonesService,
  ],
  controllers: [
    SettingsController,
    PublicSettingsController,
    CitiesController,
    ZonesController,
  ],
  exports: [SettingsService, ConfigVersionService],
})
export class SettingsModule {}
