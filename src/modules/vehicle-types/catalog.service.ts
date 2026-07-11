import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogCacheService } from "../../common/infra/catalog-cache.service";

type Audience = "passenger" | "driver" | "all";

/**
 * الكتالوج العام للتطبيقات: يُرجع الفئات المنشورة مع أنواعها المنشورة
 * وميزاتها وقواعد تسعيرها، ليبني التطبيق البطاقات ديناميكيًا دون أي قيمة ثابتة.
 * يستخدم Cache (مع رقم نسخة) ويحترم دورة النشر (لا يظهر إلا PUBLISHED).
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCacheService,
  ) {}

  /** رقم نسخة الكتالوج الحالي (للـ smart cache في التطبيقات). */
  version(): { version: number } {
    return { version: this.cache.getVersion() };
  }

  async publicCatalog(usageType?: string, audience: Audience = "passenger") {
    const key = `catalog:${audience}:${usageType ?? "ALL"}`;
    return this.cache.wrap(key, 60_000, () =>
      this.buildCatalog(usageType, audience),
    );
  }

  private async buildCatalog(usageType: string | undefined, audience: Audience) {
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
    // إخفاء الفئات التي لا تحتوي أي نوع ظاهر.
    const data = categories.filter((c) => c.types.length > 0);
    return { version: this.cache.getVersion(), categories: data };
  }
}
