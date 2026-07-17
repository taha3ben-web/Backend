import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogCacheService } from "../../common/infra/catalog-cache.service";

type Audience = "passenger" | "driver" | "all";

interface CatalogContext {
  appId?: string;
  clientOs?: string;
  countryCode?: string;
  cityId?: string;
  appVersion?: string;
  segments?: string[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCacheService,
  ) {}

  version(): { version: number } {
    return { version: this.cache.getVersion() };
  }

  async publicCatalog(
    usageType?: string,
    audience: Audience = "passenger",
    context: CatalogContext = {},
  ) {
    const key = [
      "catalog",
      audience,
      usageType ?? "ALL",
      context.appId ?? "all-apps",
      context.clientOs ?? "all-os",
      context.countryCode ?? "all-countries",
      context.cityId ?? "all-cities",
      context.appVersion ?? "all-versions",
      (context.segments ?? []).join("|") || "all-segments",
    ].join(":");
    return this.cache.wrap(key, 60_000, () =>
      this.buildCatalog(usageType, audience, context),
    );
  }

  private async buildCatalog(
    usageType: string | undefined,
    audience: Audience,
    context: CatalogContext,
  ) {
    const typeVisibility =
      audience === "driver"
        ? { visibleToDrivers: true }
        : audience === "passenger"
          ? { visibleToPassengers: true }
          : {};

    const categories = await this.prisma.vehicleCategory.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        status: "PUBLISHED",
        ...(usageType && usageType !== "BOTH"
          ? { usageType: { in: [usageType, "BOTH"] } }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        types: {
          where: {
            isActive: true,
            deletedAt: null,
            status: "PUBLISHED",
            ...typeVisibility,
            ...(usageType && usageType !== "BOTH"
              ? { usageType: { in: [usageType, "BOTH"] } }
              : {}),
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: {
            pricingRules: {
              where: { isActive: true, deletedAt: null },
              orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
              include: { serviceArea: true },
            },
            features: {
              include: { feature: true },
              where: { feature: { isActive: true, deletedAt: null } },
            },
            fields: {
              where: { isActive: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    const now = new Date();
    const data = categories
      .map((category) => ({
        ...category,
        types: category.types
          .filter((type) => this.matchesTypeTargeting(type, context))
          .map((type) => {
            const matchingPricingRules = type.pricingRules.filter((rule) =>
              this.matchesPricingRule(rule, context, now),
            );
            return {
              ...type,
              pricingRules: matchingPricingRules,
              resolvedPricing: matchingPricingRules[0] ?? null,
            };
          })
          .filter(
            (type) =>
              type.pricingRules.length > 0 ||
              type.supportsCash ||
              type.supportsWallet,
          ),
      }))
      .filter((category) => category.types.length > 0);

    return { version: this.cache.getVersion(), categories: data };
  }

  private matchesTypeTargeting(
    type: {
      appIds: string[];
      clientOs: string[];
      countryCodes: string[];
      audienceSegments: string[];
      minAppVersion: string | null;
      maxAppVersion: string | null;
    },
    context: CatalogContext,
  ) {
    if (!this.matchesArray(type.appIds, context.appId, "lower")) return false;
    if (!this.matchesArray(type.clientOs, context.clientOs, "lower"))
      return false;
    if (!this.matchesArray(type.countryCodes, context.countryCode, "upper"))
      return false;
    if (!this.matchesSegments(type.audienceSegments, context.segments))
      return false;
    if (
      !this.matchesVersion(
        context.appVersion,
        type.minAppVersion,
        type.maxAppVersion,
      )
    ) {
      return false;
    }
    return true;
  }

  private matchesPricingRule(
    rule: {
      cityId: string | null;
      country: string | null;
      appIds: string[];
      clientOs: string[];
      audienceSegments: string[];
      minAppVersion: string | null;
      maxAppVersion: string | null;
      validFrom: Date | null;
      validTo: Date | null;
      daysOfWeek: number[];
      startTime: string | null;
      endTime: string | null;
    },
    context: CatalogContext,
    now: Date,
  ) {
    if (rule.cityId && rule.cityId !== context.cityId) return false;
    if (
      rule.country &&
      rule.country.trim().toUpperCase() !==
        context.countryCode?.trim().toUpperCase()
    ) {
      return false;
    }
    if (!this.matchesArray(rule.appIds, context.appId, "lower")) return false;
    if (!this.matchesArray(rule.clientOs, context.clientOs, "lower"))
      return false;
    if (!this.matchesSegments(rule.audienceSegments, context.segments))
      return false;
    if (
      !this.matchesVersion(
        context.appVersion,
        rule.minAppVersion,
        rule.maxAppVersion,
      )
    ) {
      return false;
    }
    if (rule.validFrom && rule.validFrom > now) return false;
    if (rule.validTo && rule.validTo < now) return false;
    if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(now.getDay()))
      return false;
    if (!this.matchesTimeWindow(now, rule.startTime, rule.endTime))
      return false;
    return true;
  }

  private matchesTimeWindow(
    now: Date,
    startTime: string | null,
    endTime: string | null,
  ) {
    if (!startTime || !endTime) return true;
    const current = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    if (startTime <= endTime) {
      return current >= startTime && current <= endTime;
    }
    return current >= startTime || current <= endTime;
  }

  private matchesSegments(expected: string[], actual?: string[]) {
    if (expected.length === 0) return true;
    const normalized = new Set(
      (actual ?? []).map((item) => item.trim().toLowerCase()),
    );
    return expected.some((segment) => normalized.has(segment));
  }

  private matchesArray(
    expected: string[],
    actual: string | undefined,
    casing: "upper" | "lower",
  ) {
    if (expected.length === 0) return true;
    if (!actual) return false;
    const normalized =
      casing === "upper"
        ? actual.trim().toUpperCase()
        : actual.trim().toLowerCase();
    return expected.includes(normalized);
  }

  private matchesVersion(
    appVersion: string | undefined,
    minVersion: string | null,
    maxVersion: string | null,
  ) {
    if (!minVersion && !maxVersion) return true;
    if (!appVersion) return false;
    if (minVersion && this.compareVersions(appVersion, minVersion) < 0)
      return false;
    if (maxVersion && this.compareVersions(appVersion, maxVersion) > 0)
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
}
