import { Injectable } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import {
  DEFAULT_AVERAGE_SPEED_KMH,
  DEFAULT_MAPS_PROVIDER,
  GeoProviderService,
  MAPS_SETTING_KEYS,
} from "./geo-provider.service";
import { UpdateGeoProviderConfigDto } from "./dto/geo.dto";

const SUPPORTED_PROVIDERS = ["internal", "google"] as const;

/**
 * إدارة إعدادات مزوّد الخرائط (STAFF).
 * يخزّن القيم في Settings (group=maps)، ويعلّم المفاتيح السرية كـ sensitive
 * فلا تُعاد أبدًا في القراءة (تُقنّع).
 */
@Injectable()
export class GeoAdminService {
  constructor(
    private readonly settings: SettingsService,
    private readonly providers: GeoProviderService,
  ) {}

  /** قراءة الإعدادات الحالية (مع تقنيع المفاتيح). */
  async getConfig() {
    const config = await this.providers.resolveConfig();
    return {
      provider: config.provider,
      supportedProviders: [...SUPPORTED_PROVIDERS],
      defaultCountry: config.defaultCountry ?? "",
      averageSpeedKmh: config.averageSpeedKmh,
      hasServerApiKey: Boolean(config.serverApiKey),
      hasClientApiKey: Boolean(config.clientApiKey),
      // تلميح مقنّع للمفاتيح (آخر 4 خانات فقط).
      serverApiKeyHint: this.mask(config.serverApiKey),
      clientApiKeyHint: this.mask(config.clientApiKey),
      defaults: {
        provider: DEFAULT_MAPS_PROVIDER,
        averageSpeedKmh: DEFAULT_AVERAGE_SPEED_KMH,
      },
    };
  }

  /**
   * تحديث الإعدادات. الحقول غير المرسلة تبقى كما هي،
   * والمفتاح الفارغ لا يمسح القيمة السرية المخزّنة.
   */
  async updateConfig(dto: UpdateGeoProviderConfigDto) {
    const changed: string[] = [];

    if (dto.provider !== undefined) {
      const provider = dto.provider.toLowerCase();
      const normalized = (SUPPORTED_PROVIDERS as readonly string[]).includes(
        provider,
      )
        ? provider
        : DEFAULT_MAPS_PROVIDER;
      await this.settings.upsert({
        key: MAPS_SETTING_KEYS.provider,
        value: normalized,
        group: "maps",
        isPublic: false,
        isSensitive: false,
      });
      changed.push("provider");
    }

    if (dto.defaultCountry !== undefined) {
      await this.settings.upsert({
        key: MAPS_SETTING_KEYS.defaultCountry,
        value: dto.defaultCountry.trim().toUpperCase(),
        group: "maps",
        isPublic: false,
        isSensitive: false,
      });
      changed.push("defaultCountry");
    }

    if (dto.averageSpeedKmh !== undefined) {
      await this.settings.upsert({
        key: MAPS_SETTING_KEYS.averageSpeedKmh,
        value: dto.averageSpeedKmh,
        group: "maps",
        isPublic: false,
        isSensitive: false,
      });
      changed.push("averageSpeedKmh");
    }

    // المفاتيح السرية: تُحدّث فقط عند إرسال قيمة غير فارغة.
    if (dto.serverApiKey !== undefined && dto.serverApiKey.trim() !== "") {
      await this.settings.upsert({
        key: MAPS_SETTING_KEYS.serverApiKey,
        value: dto.serverApiKey.trim(),
        group: "maps",
        isPublic: false,
        isSensitive: true,
      });
      changed.push("serverApiKey");
    }

    if (dto.clientApiKey !== undefined && dto.clientApiKey.trim() !== "") {
      await this.settings.upsert({
        key: MAPS_SETTING_KEYS.clientApiKey,
        value: dto.clientApiKey.trim(),
        group: "maps",
        isPublic: false,
        isSensitive: true,
      });
      changed.push("clientApiKey");
    }

    const config = await this.getConfig();
    return { changed, config };
  }

  private mask(value?: string): string {
    if (!value) return "";
    if (value.length <= 4) return "••••";
    return `••••${value.slice(-4)}`;
  }
}
