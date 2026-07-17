import { Injectable } from "@nestjs/common";
import { FeatureFlagPlatform } from "@prisma/client";
import { AppVersionsService } from "../app-versions/app-versions.service";
import { SettingsService } from "../settings/settings.service";
import { ConfigVersionService } from "../settings/config-version.service";
import {
  FeatureFlagContext,
  FeatureFlagsService,
} from "../settings/feature-flags.service";
import { LegalService } from "../legal/legal.service";
import { CatalogService } from "../vehicle-types/catalog.service";
import { EmergencyService } from "../emergency/emergency.service";
import { GeoProviderService } from "../geo/geo-provider.service";
import { SavedPlacesService } from "../geo/saved-places.service";
import { BootstrapContextDto } from "./dto/bootstrap.dto";

type Audience = "passenger" | "driver" | "all";

interface ComposeOptions {
  /** معرّف المستخدم الحقيقي (للأقسام الخاصة: جهات الطوارئ/الأماكن/الموافقات). null في المعاينة. */
  userId: string | null;
  role?: string;
  /** معرّف توزيع الطرح (rollout bucketing) — عادة = userId. */
  subjectId?: string;
  ctx: BootstrapContextDto;
}

/**
 * خدمة التهيئة الموحّدة (Client Bootstrap).
 * تجمع في استدعاء واحد كل ما يحتاجه التطبيق عند الإقلاع:
 * سياسة الإصدار + الإعدادات العامة + المستندات القانونية/الموافقات
 * + الكتالوج + مفاتيح الميزات + إعداد الخرائط + جهات الطوارئ + الأماكن المحفوظة.
 */
@Injectable()
export class BootstrapService {
  constructor(
    private readonly appVersions: AppVersionsService,
    private readonly settings: SettingsService,
    private readonly configVersion: ConfigVersionService,
    private readonly flags: FeatureFlagsService,
    private readonly legal: LegalService,
    private readonly catalog: CatalogService,
    private readonly emergency: EmergencyService,
    private readonly geoProvider: GeoProviderService,
    private readonly savedPlaces: SavedPlacesService,
  ) {}

  /** تهيئة التطبيق لمستخدم مُصادَق عليه. */
  build(actor: { userId: string; role?: string }, ctx: BootstrapContextDto) {
    return this.compose({
      userId: actor.userId,
      role: actor.role,
      subjectId: actor.userId,
      ctx,
    });
  }

  /** معاينة من اللوحة: تحاكي الحمولة لسياق محدّد دون هوية حقيقية إلزامًا. */
  preview(query: {
    subjectId?: string;
    role?: string;
    ctx: BootstrapContextDto;
  }) {
    return this.compose({
      userId: query.subjectId ?? null,
      role: query.role,
      subjectId: query.subjectId,
      ctx: query.ctx,
    });
  }

  private async compose(opts: ComposeOptions) {
    const { ctx } = opts;
    const audience = this.resolveAudience(ctx.audience, opts.role);
    const segments = this.parseSegments(ctx.segments);
    const hasUser = typeof opts.userId === "string" && opts.userId.length > 0;

    const flagContext: FeatureFlagContext = {
      platform: this.resolvePlatform(audience),
      cityId: ctx.cityId,
      subjectId: opts.subjectId,
      appId: ctx.appId,
      clientOs: ctx.clientOs,
      countryCode: ctx.countryCode,
      appVersion: ctx.version,
      segments,
    };

    const catalogContext = {
      appId: ctx.appId,
      clientOs: ctx.clientOs,
      countryCode: ctx.countryCode,
      cityId: ctx.cityId,
      appVersion: ctx.version,
      segments,
    };

    const [
      config,
      versionPolicy,
      legalDocuments,
      consent,
      catalog,
      featureFlags,
      maps,
      configVersion,
      emergencyContacts,
      savedPlaces,
    ] = await Promise.all([
      this.settings.publicConfig(),
      ctx.platform && ctx.version
        ? this.appVersions.check({
            platform: ctx.platform,
            version: ctx.version,
            appId: ctx.appId,
            clientOs: ctx.clientOs,
            countryCode: ctx.countryCode,
            releaseChannel: ctx.releaseChannel,
            subjectId: opts.subjectId,
          })
        : Promise.resolve(null),
      this.legal.publicList(audience, ctx.locale),
      hasUser
        ? this.legal.pendingForUser({
            userId: opts.userId as string,
            role: opts.role,
          })
        : Promise.resolve({ pending: [], accepted: [] }),
      this.catalog.publicCatalog(ctx.usageType, audience, catalogContext),
      this.flags.evaluate(flagContext),
      this.geoProvider.publicMapsConfig(),
      this.configVersion.current(),
      hasUser
        ? this.emergency.list(opts.userId as string)
        : Promise.resolve([]),
      hasUser
        ? this.savedPlaces.list(opts.userId as string)
        : Promise.resolve([]),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      configVersion,
      user: {
        id: opts.userId,
        role: opts.role ?? null,
        audience,
        authenticated: hasUser,
      },
      app: {
        platform: ctx.platform ?? null,
        version: ctx.version ?? null,
        releaseChannel: ctx.releaseChannel ?? null,
        versionPolicy,
      },
      config,
      maps,
      legal: { documents: legalDocuments, consent },
      catalog,
      featureFlags,
      emergencyContacts,
      savedPlaces,
    };
  }

  private resolveAudience(audience: string | undefined, role?: string): Audience {
    if (audience === "passenger" || audience === "driver" || audience === "all") {
      return audience;
    }
    if (role === "DRIVER") return "driver";
    if (role === "PASSENGER") return "passenger";
    return "passenger";
  }

  private resolvePlatform(audience: Audience): FeatureFlagPlatform {
    if (audience === "driver") return FeatureFlagPlatform.DRIVER;
    if (audience === "passenger") return FeatureFlagPlatform.PASSENGER;
    return FeatureFlagPlatform.ALL;
  }

  private parseSegments(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
}
