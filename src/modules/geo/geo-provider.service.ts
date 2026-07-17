import { Injectable } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { InternalGeoProvider } from "./providers/internal-geo.provider";
import { GoogleGeoProvider } from "./providers/google-geo.provider";
import {
  GeoProvider,
  GeoProviderContext,
} from "./providers/geo-provider.interface";

/** مفاتيح إعدادات الخرائط في Settings (group = "maps"). */
export const MAPS_SETTING_KEYS = {
  provider: "maps.provider",
  serverApiKey: "maps.serverApiKey",
  clientApiKey: "maps.clientApiKey",
  defaultCountry: "maps.defaultCountry",
  averageSpeedKmh: "maps.averageSpeedKmh",
} as const;

export const DEFAULT_MAPS_PROVIDER = "internal";
export const DEFAULT_AVERAGE_SPEED_KMH = 30;

export interface ResolvedGeoConfig {
  provider: string;
  serverApiKey?: string;
  clientApiKey?: string;
  defaultCountry?: string;
  averageSpeedKmh: number;
}

/**
 * يحلّ مزوّد الخرائط الفعّال ومفاتيحه من اللوحة (Settings)،
 * ويختار التنفيذ المناسب. الافتراضي الآمن: internal (offline).
 */
@Injectable()
export class GeoProviderService {
  constructor(
    private readonly settings: SettingsService,
    private readonly internalProvider: InternalGeoProvider,
    private readonly googleProvider: GoogleGeoProvider,
  ) {}

  async resolveConfig(): Promise<ResolvedGeoConfig> {
    const [provider, serverApiKey, clientApiKey, defaultCountry, avgSpeed] =
      await Promise.all([
        this.settings.getValue<string>(
          MAPS_SETTING_KEYS.provider,
          DEFAULT_MAPS_PROVIDER,
        ),
        this.settings.getValue<string>(MAPS_SETTING_KEYS.serverApiKey, ""),
        this.settings.getValue<string>(MAPS_SETTING_KEYS.clientApiKey, ""),
        this.settings.getValue<string>(MAPS_SETTING_KEYS.defaultCountry, ""),
        this.settings.getValue<number>(
          MAPS_SETTING_KEYS.averageSpeedKmh,
          DEFAULT_AVERAGE_SPEED_KMH,
        ),
      ]);
    const speed = Number(avgSpeed);
    return {
      provider: (provider || DEFAULT_MAPS_PROVIDER).toLowerCase(),
      serverApiKey: serverApiKey || undefined,
      clientApiKey: clientApiKey || undefined,
      defaultCountry: defaultCountry || undefined,
      averageSpeedKmh:
        Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_AVERAGE_SPEED_KMH,
    };
  }

  /**
   * إعداد الخرائط العام الآمن للتطبيق (Bootstrap): يكشف اسم المزوّد الفعّال
   * والمفتاح العميل (clientApiKey) والدولة الافتراضية ومتوسط السرعة فقط.
   * لا يكشف أبدًا مفتاح الخادم (serverApiKey).
   */
  async publicMapsConfig(): Promise<{
    provider: string;
    clientApiKey: string | null;
    defaultCountry: string | null;
    averageSpeedKmh: number;
  }> {
    const config = await this.resolveConfig();
    const { provider } = this.select(config);
    return {
      provider: provider.name,
      clientApiKey: config.clientApiKey ?? null,
      defaultCountry: config.defaultCountry ?? null,
      averageSpeedKmh: config.averageSpeedKmh,
    };
  }

  /** يختار تنفيذ المزوّد. يرجع للداخلي إذا غاب المفتاح. */
  select(config: ResolvedGeoConfig): {
    provider: GeoProvider;
    ctx: GeoProviderContext;
  } {
    let provider: GeoProvider = this.internalProvider;
    if (config.provider === "google" && config.serverApiKey) {
      provider = this.googleProvider;
    }
    return {
      provider,
      ctx: {
        provider: provider.name,
        serverApiKey: config.serverApiKey,
        defaultCountry: config.defaultCountry,
        averageSpeedKmh: config.averageSpeedKmh,
      },
    };
  }

  async resolve(): Promise<{
    provider: GeoProvider;
    ctx: GeoProviderContext;
    config: ResolvedGeoConfig;
  }> {
    const config = await this.resolveConfig();
    const { provider, ctx } = this.select(config);
    return { provider, ctx, config };
  }
}
