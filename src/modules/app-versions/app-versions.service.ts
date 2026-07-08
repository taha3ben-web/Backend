import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAppVersionDto } from "./dto/app-versions.dto";

/**
 * إدارة إصدارات التطبيق وبوابة التحديث الإجباري.
 * يُقارن إصدار الجهاز مع أحدث إصدار وأدنى إصدار مدعوم.
 */
@Injectable()
export class AppVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateAppVersionDto) {
    return this.prisma.appVersion.create({
      data: {
        platform: dto.platform,
        version: dto.version,
        minSupported: dto.minSupported ?? null,
        forceUpdate: dto.forceUpdate ?? false,
        url: dto.url ?? null,
      },
    });
  }

  findAll(platform?: string) {
    return this.prisma.appVersion.findMany({
      where: platform ? { platform } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async remove(id: string) {
    await this.prisma.appVersion.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * فحص إصدار الجهاز: يُرجِع أحدث إصدار وهل يجب التحديث.
   * updateRequired: الإصدار أقدم من أدنى إصدار مدعوم (أو forceUpdate مفعّل).
   */
  async check(platform: string, currentVersion: string) {
    const latest = await this.prisma.appVersion.findFirst({
      where: { platform },
      orderBy: { createdAt: "desc" },
    });

    if (!latest) {
      return {
        platform,
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        updateRequired: false,
        url: null,
      };
    }

    const updateAvailable = this.compare(currentVersion, latest.version) < 0;
    const belowMin = latest.minSupported
      ? this.compare(currentVersion, latest.minSupported) < 0
      : false;
    const updateRequired = belowMin || (latest.forceUpdate && updateAvailable);

    return {
      platform,
      currentVersion,
      latestVersion: latest.version,
      minSupported: latest.minSupported,
      updateAvailable,
      updateRequired,
      url: latest.url,
    };
  }

  /**
   * مقارنة إصدارات دلالية (semantic) مثل 1.2.3.
   * يُرجِع -1 إذا a<b، 0 إذا تساويا، 1 إذا a>b.
   */
  private compare(a: string, b: string): number {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }
}
