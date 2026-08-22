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
  /**
   * عنوان خدمة OSRM المستضافة ذاتيًا، مثال: http://osrm:5000
   * @deprecated المرحلة 7: OSRM لن يُستخدم في الإنتاج. المفتاح يبقى لعدم كسر
   * الإعدادات المخزّنة، ولكن لا يُختار OSRM تلقائيًا أبدًا (انظر select).
   */
  osrmBaseUrl: "maps.osrmBaseUrl",
} as const;

/**
 * المزوّد الافتراضي للمسافة والمدة والمسار.
 *
 * المرحلة 7: المالك اعتمد **Google Routes API** رسميًا وألغى OSRM نهائيًا،
 * لذلك الافتراضي أصبح "google" بدل "internal".
 *
 * ملاحظة مهمة: هذا لا يخترع مفتاحًا. ما دام maps.serverApiKey فارغًا
 * يرتد select() تلقائيًا إلى المزوّد الداخلي التقريبي، فيعمل النظام قبل إعداد
 * Google Cloud ويتحوّل إلى Routes API تلقائيًا لحظة إدخال المفتاح من اللوحة.
 */
export const DEFAULT_MAPS_PROVIDER = "google";

/**
 * مزوّدون متروكون (legacy): موجودون في الكود ولا تُحذف ملفاتهم،
 * لكن لا يُختارون في تشغيل الإنتاج.
 */
export const DEPRECATED_MAPS_PROVIDERS = ["osrm"] as const;

export const DEFAULT_AVERAGE_SPEED_KMH = 30;

export interface ResolvedGeoConfig {
  provider: string;
  serverApiKey?: string;
  clientApiKey?: string;
  defaultCountry?: string;
  averageSpeedKmh: number;
  osrmBaseUrl?: string;
}

/**
 * يحلّ مزوّد الخرائط الفعّال ومفاتيحه من اللوحة (Settings)، ويختار التنفيذ المناسب.
 *
 * المرحلة 7 — سياسة المزوّد:
 * - المعتمد: google (Routes API v2 للمسافة/المدة/المسار).
 * - internal: ارتداد تقريبي فقط قبل إدخال مفتاح Google، أو عند فشل المزوّد.
 * - osrm: **متروك نهائيًا**. لا يُختار حتى لو كان maps.osrmBaseUrl مضبوطًا في
 *   قاعدة البيانات من إعداد قديم؛ يُتجاهل ويُرتد إلى الداخلي. ملفات OsrmGeoProvider
 *   تبقى موجودة دون حذف كما هي سياسة المشروع (لا حذف أنظمة قابلة للإحياء).
 */
@Injectable()
export class GeoProviderService {
  constructor(
    private readonly settings: SettingsService,
    private readonly internalProvider: InternalGeoProvider,
    private readonly googleProvider: GoogleGeoProvider,
  ) {}

  async resolveConfig(): Promise<ResolvedGeoConfig> {
    const [
      provider,
      serverApiKey,
      clientApiKey,
      defaultCountry,
      avgSpeed,
      osrmBaseUrl,
    ] = await Promise.all([
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
      this.settings.getValue<string>(MAPS_SETTING_KEYS.osrmBaseUrl, ""),
    ]);
    const speed = Number(avgSpeed);
    // اللوحة أولوية، ومتغير البيئة احتياط للنشر الأول قبل ضبط الإعدادات.
    const resolvedOsrmBaseUrl =
      (osrmBaseUrl || process.env.OSRM_BASE_URL || "").trim() || undefined;
    return {
      provider: (provider || DEFAULT_MAPS_PROVIDER).toLowerCase(),
      serverApiKey: serverApiKey || undefined,
      clientApiKey: clientApiKey || undefined,
      defaultCountry: defaultCountry || undefined,
      averageSpeedKmh:
        Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_AVERAGE_SPEED_KMH,
      osrmBaseUrl: resolvedOsrmBaseUrl,
    };
  }

  /**
   * إعداد الخرائط العام الآمن للتطبيق (Bootstrap): يكشف اسم المزوّد الفعّال
   * والمفتاح العميل (clientApiKey) والدولة الافتراضية ومتوسط السرعة فقط.
   * لا يكشف أبدًا مفتاح الخادم (serverApiKey) ولا عنوان OSRM الداخلي.
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

  /**
   * يختار تنفيذ المزوّد. يرجع للداخلي إذا غاب مفتاح Google.
   *
   * OSRM مستبعد صراحة (المرحلة 7): حتى لو كان provider === "osrm"
   * مخزّنًا من إعداد قديم، لا نستخدمه. هذا يمنع عودة النظام خلسةً إلى
   * مصدر مسافة/مدة ألغاه المالك.
   */
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
        baseUrl: config.osrmBaseUrl,
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
