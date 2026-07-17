import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CheckAppVersionDto,
  CreateAppVersionDto,
  UpdateAppVersionDto,
} from "./dto/app-versions.dto";

/**
 * إدارة إصدارات التطبيق وسياسات الإطلاق التدريجي والتحديث الإجباري.
 */
@Injectable()
export class AppVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateAppVersionDto) {
    return this.prisma.appVersion.create({
      data: {
        platform: this.normalizeLower(dto.platform),
        appId: dto.appId?.trim() || null,
        clientOs: dto.clientOs ? this.normalizeLower(dto.clientOs) : null,
        countryCodes: this.normalizeUpperArray(dto.countryCodes ?? []),
        releaseChannel: this.normalizeLower(dto.releaseChannel ?? "stable"),
        status: dto.status ?? "ACTIVE",
        version: dto.version.trim(),
        minSupported: dto.minSupported?.trim() || null,
        forceUpdate: dto.forceUpdate ?? false,
        rolloutPercentage: dto.rolloutPercentage ?? 100,
        releaseNotes: dto.releaseNotes?.trim() || null,
        updateTitle: dto.updateTitle?.trim() || null,
        updateMessage: dto.updateMessage?.trim() || null,
        url: dto.url?.trim() || null,
      },
    });
  }

  findAll(filters?: {
    platform?: string;
    appId?: string;
    releaseChannel?: string;
  }) {
    return this.prisma.appVersion.findMany({
      where: {
        ...(filters?.platform
          ? { platform: this.normalizeLower(filters.platform) }
          : {}),
        ...(filters?.appId ? { appId: filters.appId.trim() } : {}),
        ...(filters?.releaseChannel
          ? { releaseChannel: this.normalizeLower(filters.releaseChannel) }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  async update(id: string, dto: UpdateAppVersionDto) {
    await this.requireRow(id);
    return this.prisma.appVersion.update({
      where: { id },
      data: {
        ...(dto.platform !== undefined
          ? { platform: this.normalizeLower(dto.platform) }
          : {}),
        ...(dto.appId !== undefined
          ? { appId: dto.appId?.trim() || null }
          : {}),
        ...(dto.clientOs !== undefined
          ? {
              clientOs: dto.clientOs ? this.normalizeLower(dto.clientOs) : null,
            }
          : {}),
        ...(dto.countryCodes !== undefined
          ? { countryCodes: this.normalizeUpperArray(dto.countryCodes) }
          : {}),
        ...(dto.releaseChannel !== undefined
          ? { releaseChannel: this.normalizeLower(dto.releaseChannel) }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.version !== undefined ? { version: dto.version.trim() } : {}),
        ...(dto.minSupported !== undefined
          ? { minSupported: dto.minSupported?.trim() || null }
          : {}),
        ...(dto.forceUpdate !== undefined
          ? { forceUpdate: dto.forceUpdate }
          : {}),
        ...(dto.rolloutPercentage !== undefined
          ? { rolloutPercentage: dto.rolloutPercentage }
          : {}),
        ...(dto.releaseNotes !== undefined
          ? { releaseNotes: dto.releaseNotes?.trim() || null }
          : {}),
        ...(dto.updateTitle !== undefined
          ? { updateTitle: dto.updateTitle?.trim() || null }
          : {}),
        ...(dto.updateMessage !== undefined
          ? { updateMessage: dto.updateMessage?.trim() || null }
          : {}),
        ...(dto.url !== undefined ? { url: dto.url?.trim() || null } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.requireRow(id);
    await this.prisma.appVersion.delete({ where: { id } });
    return { ok: true };
  }

  async check(dto: CheckAppVersionDto) {
    const platform = this.normalizeLower(dto.platform);
    const appId = dto.appId?.trim();
    const clientOs = dto.clientOs
      ? this.normalizeLower(dto.clientOs)
      : undefined;
    const releaseChannel = this.normalizeLower(dto.releaseChannel ?? "stable");
    const countryCode = dto.countryCode?.trim().toUpperCase();
    const currentVersion = dto.version.trim();
    const subjectId = dto.subjectId?.trim();

    const rows = await this.prisma.appVersion.findMany({
      where: {
        platform,
        releaseChannel,
        status: "ACTIVE",
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const candidates = rows.filter((row) => {
      if (row.appId && row.appId !== appId) return false;
      if (row.clientOs && row.clientOs !== clientOs) return false;
      if (row.countryCodes.length > 0) {
        if (!countryCode || !row.countryCodes.includes(countryCode))
          return false;
      }
      return true;
    });

    const latest = candidates[0] ?? null;
    if (!latest) {
      return {
        platform,
        currentVersion,
        releaseChannel,
        latestVersion: null,
        minSupported: null,
        updateAvailable: false,
        updateRequired: false,
        rolloutEligible: false,
        rolloutPercentage: 0,
        url: null,
        releaseNotes: null,
        updateTitle: null,
        updateMessage: null,
      };
    }

    const updateAvailable = this.compare(currentVersion, latest.version) < 0;
    const belowMin = latest.minSupported
      ? this.compare(currentVersion, latest.minSupported) < 0
      : false;
    const rolloutEligible = this.isRolloutEligible(
      latest.version,
      subjectId,
      latest.rolloutPercentage,
    );
    const forcedByMin = belowMin;
    const forcedByFlag =
      latest.forceUpdate && updateAvailable && rolloutEligible;
    const updateRequired = forcedByMin || forcedByFlag;

    return {
      platform,
      currentVersion,
      releaseChannel,
      appId: latest.appId,
      clientOs: latest.clientOs,
      countryCodes: latest.countryCodes,
      latestVersion: latest.version,
      minSupported: latest.minSupported,
      updateAvailable: updateAvailable && rolloutEligible,
      updateRequired,
      rolloutEligible,
      rolloutPercentage: latest.rolloutPercentage,
      forceUpdate: latest.forceUpdate,
      forcedByMin,
      forcedByFlag,
      url: latest.url,
      releaseNotes: latest.releaseNotes,
      updateTitle: latest.updateTitle,
      updateMessage: latest.updateMessage,
    };
  }

  private async requireRow(id: string) {
    const row = await this.prisma.appVersion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("سياسة الإصدار غير موجودة");
    return row;
  }

  private isRolloutEligible(
    version: string,
    subjectId: string | undefined,
    rolloutPercentage: number,
  ) {
    if (rolloutPercentage >= 100) return true;
    if (rolloutPercentage <= 0 || !subjectId) return false;
    const bucket = this.bucket(`${version}:${subjectId}`);
    return bucket < rolloutPercentage;
  }

  private bucket(value: string) {
    const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
    return Number.parseInt(digest, 16) % 100;
  }

  private compare(a: string, b: string): number {
    const pa = this.versionParts(a);
    const pb = this.versionParts(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  private versionParts(value: string) {
    return (value.match(/\d+/g) ?? []).map((item) => Number.parseInt(item, 10));
  }

  private normalizeLower(value: string) {
    return value.trim().toLowerCase();
  }

  private normalizeUpperArray(values: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const next = value.trim().toUpperCase();
      if (!next || seen.has(next)) continue;
      seen.add(next);
      result.push(next);
    }
    return result;
  }
}
