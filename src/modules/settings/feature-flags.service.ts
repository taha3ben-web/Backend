import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { FeatureFlagPlatform, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigVersionService } from "./config-version.service";
import {
  CreateFeatureFlagDto,
  RolloutStageDto,
  UpdateFeatureFlagControlDto,
  UpdateFeatureFlagDto,
} from "./dto/feature-flags.dto";

const GLOBAL_CONTROL_KEY = "global";

type RolloutStage = { startsAt: string; percentage: number; label?: string };

export interface FeatureFlagContext {
  platform?: FeatureFlagPlatform;
  cityId?: string;
  subjectId?: string;
  appId?: string;
  clientOs?: string;
  countryCode?: string;
  appVersion?: string;
  segments?: string[];
}

@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
  ) {}

  findAll(search?: string) {
    const query = search?.trim();
    return this.prisma.featureFlag.findMany({
      where: query
        ? {
            OR: [
              { key: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ key: "asc" }],
    });
  }

  async getControl() {
    return this.prisma.featureFlagControl.upsert({
      where: { key: GLOBAL_CONTROL_KEY },
      update: {},
      create: { key: GLOBAL_CONTROL_KEY },
    });
  }

  async updateControl(dto: UpdateFeatureFlagControlDto) {
    const updated = await this.prisma.featureFlagControl.upsert({
      where: { key: GLOBAL_CONTROL_KEY },
      update: {
        ...(dto.globalKillSwitch !== undefined
          ? { globalKillSwitch: dto.globalKillSwitch }
          : {}),
        ...(dto.globalKillReason !== undefined
          ? { globalKillReason: dto.globalKillReason?.trim() || null }
          : {}),
      },
      create: {
        key: GLOBAL_CONTROL_KEY,
        globalKillSwitch: dto.globalKillSwitch ?? false,
        globalKillReason: dto.globalKillReason?.trim() || null,
      },
    });
    await this.versions.bump();
    return updated;
  }

  async create(dto: CreateFeatureFlagDto) {
    await this.ensureKeyAvailable(dto.key);
    const normalized = await this.normalizeTargeting(dto);
    const created = await this.prisma.featureFlag.create({
      data: {
        key: dto.key.trim(),
        description: dto.description?.trim() || null,
        enabled: dto.enabled ?? false,
        platform: dto.platform ?? FeatureFlagPlatform.ALL,
        cityIds: normalized.cityIds,
        countryCodes: normalized.countryCodes,
        appIds: normalized.appIds,
        clientOs: normalized.clientOs,
        audienceSegments: normalized.audienceSegments,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
        rolloutPlan:
          normalized.rolloutPlan.length > 0
            ? (normalized.rolloutPlan as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        minAppVersion: dto.minAppVersion?.trim() || null,
        maxAppVersion: dto.maxAppVersion?.trim() || null,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
      },
    });
    await this.versions.bump();
    return created;
  }

  async update(id: string, dto: UpdateFeatureFlagDto) {
    const current = await this.findOne(id);
    const normalized = await this.normalizeTargeting(dto, current);
    const updated = await this.prisma.featureFlag.update({
      where: { id },
      data: {
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.platform !== undefined ? { platform: dto.platform } : {}),
        ...(dto.cityIds !== undefined ? { cityIds: normalized.cityIds } : {}),
        ...(dto.countryCodes !== undefined
          ? { countryCodes: normalized.countryCodes }
          : {}),
        ...(dto.appIds !== undefined ? { appIds: normalized.appIds } : {}),
        ...(dto.clientOs !== undefined
          ? { clientOs: normalized.clientOs }
          : {}),
        ...(dto.audienceSegments !== undefined
          ? { audienceSegments: normalized.audienceSegments }
          : {}),
        ...(dto.rolloutPercentage !== undefined
          ? { rolloutPercentage: dto.rolloutPercentage }
          : {}),
        ...(dto.rolloutPlan !== undefined
          ? {
              rolloutPlan:
                normalized.rolloutPlan.length > 0
                  ? (normalized.rolloutPlan as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
            }
          : {}),
        ...(dto.minAppVersion !== undefined
          ? { minAppVersion: dto.minAppVersion?.trim() || null }
          : {}),
        ...(dto.maxAppVersion !== undefined
          ? { maxAppVersion: dto.maxAppVersion?.trim() || null }
          : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: normalized.startsAt }
          : {}),
        ...(dto.endsAt !== undefined ? { endsAt: normalized.endsAt } : {}),
        version: { increment: 1 },
      },
    });
    await this.versions.bump();
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.featureFlag.delete({ where: { id } });
    await this.versions.bump();
    return { success: true };
  }

  async evaluate(context: FeatureFlagContext) {
    const [control, flags] = await Promise.all([
      this.getControl(),
      this.prisma.featureFlag.findMany({
        where: { enabled: true },
        orderBy: { key: "asc" },
      }),
    ]);
    const now = new Date();
    const values: Record<string, boolean> = {};
    const versions: Record<string, number> = {};
    const effectivePercentages: Record<string, number> = {};

    for (const flag of flags) {
      const effectivePercentage = this.resolveRolloutPercentage(flag, now);
      effectivePercentages[flag.key] = effectivePercentage;
      values[flag.key] = control.globalKillSwitch
        ? false
        : this.isEnabled(flag, context, now, effectivePercentage);
      versions[flag.key] = flag.version;
    }

    return {
      values,
      versions,
      effectivePercentages,
      globalKillSwitchEnabled: control.globalKillSwitch,
      globalKillReason: control.globalKillReason,
      evaluatedAt: now.toISOString(),
    };
  }

  /**
   * نظرة صحة/دورة حياة لمفاتيح الميزات (قراءة فقط) — تجمع
   * مفتاح الإيقاف العام والعدّادات وإشارات الصحة لكل مفتاح
   * (منتهٍ/مجدول/توزيع جزئي/راكد) دون سياق تقييم.
   */
  async health() {
    const now = new Date();
    const [control, flags] = await Promise.all([
      this.getControl(),
      this.prisma.featureFlag.findMany({ orderBy: { key: "asc" } }),
    ]);

    const STALE_MS = 60 * 24 * 60 * 60 * 1000;
    const ENDING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

    let enabled = 0;
    let scheduled = 0;
    let expired = 0;
    let partialRollout = 0;
    let scoped = 0;
    let needsAttention = 0;

    const items = flags.map((flag) => {
      const effectivePercentage = this.resolveRolloutPercentage(flag, now);
      const hasRolloutPlan = this.readRolloutPlan(flag.rolloutPlan).length > 0;
      const isScheduled = Boolean(flag.startsAt && flag.startsAt > now);
      const isExpired = Boolean(flag.endsAt && flag.endsAt <= now);
      const isEndingSoon = Boolean(
        flag.endsAt &&
          flag.endsAt > now &&
          flag.endsAt.getTime() - now.getTime() <= ENDING_SOON_MS,
      );
      const isPartial =
        !isScheduled && !isExpired && effectivePercentage < 100;
      const isScoped =
        flag.platform !== FeatureFlagPlatform.ALL ||
        flag.cityIds.length > 0 ||
        flag.countryCodes.length > 0 ||
        flag.appIds.length > 0 ||
        flag.clientOs.length > 0 ||
        flag.audienceSegments.length > 0;
      const isStale =
        flag.enabled &&
        !isPartial &&
        now.getTime() - flag.updatedAt.getTime() > STALE_MS;

      const health: string[] = [];
      if (control.globalKillSwitch && flag.enabled) health.push("KILLED");
      if (isExpired) health.push(flag.enabled ? "EXPIRED_ENABLED" : "EXPIRED");
      if (isScheduled) health.push("SCHEDULED");
      if (isEndingSoon) health.push("ENDING_SOON");
      if (isPartial && flag.enabled) health.push("PARTIAL_ROLLOUT");
      if (isStale) health.push("STALE");

      if (flag.enabled) enabled += 1;
      if (isScheduled) scheduled += 1;
      if (isExpired) expired += 1;
      if (isPartial && flag.enabled) partialRollout += 1;
      if (isScoped) scoped += 1;
      const attention =
        health.includes("KILLED") ||
        health.includes("EXPIRED_ENABLED") ||
        health.includes("STALE");
      if (attention) needsAttention += 1;

      return {
        id: flag.id,
        key: flag.key,
        description: flag.description,
        enabled: flag.enabled,
        platform: flag.platform,
        effectivePercentage,
        rolloutPercentage: flag.rolloutPercentage,
        hasRolloutPlan,
        scoped: isScoped,
        cityCount: flag.cityIds.length,
        countryCodes: flag.countryCodes,
        appIds: flag.appIds,
        clientOs: flag.clientOs,
        audienceSegments: flag.audienceSegments,
        minAppVersion: flag.minAppVersion,
        maxAppVersion: flag.maxAppVersion,
        startsAt: flag.startsAt,
        endsAt: flag.endsAt,
        version: flag.version,
        updatedAt: flag.updatedAt,
        health,
        attention,
      };
    });

    return {
      control: {
        globalKillSwitch: control.globalKillSwitch,
        globalKillReason: control.globalKillReason,
      },
      evaluatedAt: now.toISOString(),
      totals: {
        total: flags.length,
        enabled,
        disabled: flags.length - enabled,
        scheduled,
        expired,
        partialRollout,
        scoped,
        needsAttention,
        killed: control.globalKillSwitch ? enabled : 0,
      },
      items,
    };
  }

  private async findOne(id: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException("مفتاح الميزة غير موجود");
    return flag;
  }

  private isEnabled(
    flag: {
      key: string;
      platform: FeatureFlagPlatform;
      cityIds: string[];
      countryCodes: string[];
      appIds: string[];
      clientOs: string[];
      audienceSegments: string[];
      rolloutPercentage: number;
      minAppVersion: string | null;
      maxAppVersion: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      rolloutPlan: Prisma.JsonValue | null;
    },
    context: FeatureFlagContext,
    now: Date,
    effectivePercentage: number,
  ): boolean {
    if (flag.startsAt && flag.startsAt > now) return false;
    if (flag.endsAt && flag.endsAt <= now) return false;
    if (
      flag.platform !== FeatureFlagPlatform.ALL &&
      flag.platform !== context.platform
    ) {
      return false;
    }
    if (flag.cityIds.length > 0) {
      if (!context.cityId || !flag.cityIds.includes(context.cityId))
        return false;
    }
    if (flag.countryCodes.length > 0) {
      const country = context.countryCode?.trim().toUpperCase();
      if (!country || !flag.countryCodes.includes(country)) return false;
    }
    if (flag.appIds.length > 0) {
      const appId = context.appId?.trim().toLowerCase();
      if (!appId || !flag.appIds.includes(appId)) return false;
    }
    if (flag.clientOs.length > 0) {
      const clientOs = context.clientOs?.trim().toLowerCase();
      if (!clientOs || !flag.clientOs.includes(clientOs)) return false;
    }
    if (flag.audienceSegments.length > 0) {
      const segments = (context.segments ?? []).map((item) =>
        item.toLowerCase(),
      );
      if (
        !segments.some((segment) => flag.audienceSegments.includes(segment))
      ) {
        return false;
      }
    }
    if (
      !this.matchesAppVersion(
        context.appVersion,
        flag.minAppVersion,
        flag.maxAppVersion,
      )
    ) {
      return false;
    }
    if (effectivePercentage >= 100) return true;
    if (effectivePercentage <= 0 || !context.subjectId) return false;
    return this.bucket(flag.key, context.subjectId) < effectivePercentage;
  }

  private resolveRolloutPercentage(
    flag: { rolloutPercentage: number; rolloutPlan: Prisma.JsonValue | null },
    now: Date,
  ) {
    const plan = this.readRolloutPlan(flag.rolloutPlan);
    if (plan.length === 0) return flag.rolloutPercentage;
    let resolved = 0;
    for (const stage of plan) {
      if (new Date(stage.startsAt) <= now) {
        resolved = stage.percentage;
      }
    }
    return resolved;
  }

  private readRolloutPlan(value: Prisma.JsonValue | null): RolloutStage[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RolloutStage => {
      return Boolean(
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as { startsAt?: unknown }).startsAt === "string" &&
        typeof (item as { percentage?: unknown }).percentage === "number",
      );
    });
  }

  private matchesAppVersion(
    version: string | undefined,
    minVersion: string | null,
    maxVersion: string | null,
  ) {
    if (!minVersion && !maxVersion) return true;
    if (!version) return false;
    if (minVersion && this.compareVersions(version, minVersion) < 0)
      return false;
    if (maxVersion && this.compareVersions(version, maxVersion) > 0)
      return false;
    return true;
  }

  private compareVersions(left: string, right: string) {
    const leftParts = this.versionParts(left);
    const rightParts = this.versionParts(right);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const a = leftParts[index] ?? 0;
      const b = rightParts[index] ?? 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
  }

  private versionParts(version: string) {
    const matches = version.match(/\d+/g) ?? [];
    return matches.map((item) => Number.parseInt(item, 10));
  }

  private bucket(key: string, subjectId: string): number {
    const digest = createHash("sha256")
      .update(`${key}:${subjectId}`)
      .digest("hex")
      .slice(0, 8);
    return Number.parseInt(digest, 16) % 100;
  }

  private async ensureKeyAvailable(key: string) {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: key.trim() },
      select: { id: true },
    });
    if (existing) throw new BadRequestException("مفتاح الميزة موجود مسبقًا");
  }

  private async normalizeTargeting(
    dto: Partial<CreateFeatureFlagDto & UpdateFeatureFlagDto>,
    current?: {
      cityIds: string[];
      countryCodes: string[];
      appIds: string[];
      clientOs: string[];
      audienceSegments: string[];
      startsAt: Date | null;
      endsAt: Date | null;
      rolloutPlan: Prisma.JsonValue | null;
    },
  ) {
    const cityIds = dto.cityIds ?? current?.cityIds ?? [];
    await this.validateCities(cityIds);
    const startsAt =
      dto.startsAt === undefined
        ? (current?.startsAt ?? null)
        : this.toDate(dto.startsAt);
    const endsAt =
      dto.endsAt === undefined
        ? (current?.endsAt ?? null)
        : this.toDate(dto.endsAt);
    this.assertSchedule(startsAt, endsAt);
    const rolloutPlanInput =
      dto.rolloutPlan === undefined
        ? this.readRolloutPlan(current?.rolloutPlan ?? null)
        : (dto.rolloutPlan ?? []);
    const rolloutPlan = this.normalizeRolloutPlan(rolloutPlanInput);
    return {
      cityIds,
      countryCodes: this.normalizeStringArray(
        dto.countryCodes ?? current?.countryCodes ?? [],
        "upper",
      ),
      appIds: this.normalizeStringArray(
        dto.appIds ?? current?.appIds ?? [],
        "lower",
      ),
      clientOs: this.normalizeStringArray(
        dto.clientOs ?? current?.clientOs ?? [],
        "lower",
      ),
      audienceSegments: this.normalizeStringArray(
        dto.audienceSegments ?? current?.audienceSegments ?? [],
        "lower",
      ),
      startsAt,
      endsAt,
      rolloutPlan,
    };
  }

  private normalizeRolloutPlan(stages: Array<RolloutStageDto | RolloutStage>) {
    const normalized = stages
      .map((stage) => ({
        startsAt: new Date(stage.startsAt).toISOString(),
        percentage: stage.percentage,
        ...(stage.label?.trim() ? { label: stage.label.trim() } : {}),
      }))
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

    for (const stage of normalized) {
      if (stage.percentage < 0 || stage.percentage > 100) {
        throw new BadRequestException("نسبة كل مرحلة يجب أن تكون بين 0 و100");
      }
      if (Number.isNaN(Date.parse(stage.startsAt))) {
        throw new BadRequestException("تواريخ مراحل التوزيع غير صالحة");
      }
    }
    return normalized;
  }

  private normalizeStringArray(values: string[], casing: "upper" | "lower") {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const next =
        casing === "upper" ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (seen.has(next)) continue;
      seen.add(next);
      normalized.push(next);
    }
    return normalized;
  }

  private async validateCities(cityIds: string[]) {
    if (cityIds.length === 0) return;
    const count = await this.prisma.city.count({
      where: { id: { in: cityIds } },
    });
    if (count !== cityIds.length) {
      throw new BadRequestException("تتضمن القائمة مدينة غير موجودة");
    }
  }

  private toDate(value?: string | Date | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("قيمة التاريخ غير صالحة");
    }
    return date;
  }

  private assertSchedule(startsAt: Date | null, endsAt: Date | null) {
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException("وقت النهاية يجب أن يكون بعد وقت البداية");
    }
  }
}
