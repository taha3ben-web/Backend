import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogCacheService } from "../../common/infra/catalog-cache.service";

interface TypeStat {
  vehicleTypeId: string;
  name: string;
  trips: number;
  revenue: number;
  avgFare: number;
  drivers: number;
}

export interface CatalogAnalytics {
  generatedAt: string;
  totals: {
    categories: number;
    types: number;
    publishedTypes: number;
    pricingRules: number;
    features: number;
    serviceAreas: number;
  };
  perType: TypeStat[];
  mostUsed: TypeStat | null;
  leastUsed: TypeStat | null;
  mostProfitable: TypeStat | null;
}

/**
 * تحليلات الكتالوج للوحة (أكثر من مجرد CRUD):
 * عدد الأنواع، السائقون لكل نوع، الأكثر استخدامًا، الأكثر ربحًا، الأقل استخدامًا، متوسط السعر.
 */
@Injectable()
export class CatalogAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCacheService,
  ) {}

  async overview(): Promise<CatalogAnalytics> {
    return this.cache.wrap("catalog:analytics", 30_000, () => this.build());
  }

  private num(v: unknown): number {
    if (v == null) return 0;
    return typeof v === "number" ? v : Number(v.toString());
  }

  private async build(): Promise<CatalogAnalytics> {
    const [
      categories,
      types,
      publishedTypes,
      pricingRules,
      features,
      serviceAreas,
      typeRows,
      tripGroups,
      vehicleGroups,
    ] = await this.prisma.$transaction([
      this.prisma.vehicleCategory.count({ where: { deletedAt: null } }),
      this.prisma.vehicleType.count({ where: { deletedAt: null } }),
      this.prisma.vehicleType.count({
        where: { deletedAt: null, status: "PUBLISHED" },
      }),
      this.prisma.vehiclePricingRule.count({ where: { deletedAt: null } }),
      this.prisma.feature.count({ where: { deletedAt: null } }),
      this.prisma.serviceArea.count({ where: { deletedAt: null } }),
      this.prisma.vehicleType.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.trip.groupBy({
        by: ["vehicleTypeId"],
        where: { status: "COMPLETED", vehicleTypeId: { not: null } },
        _count: { _all: true },
        _sum: { fare: true },
        _avg: { fare: true },
      }),
      this.prisma.vehicle.groupBy({
        by: ["vehicleTypeId"],
        where: { isActive: true, vehicleTypeId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const tripMap = new Map(tripGroups.map((g) => [g.vehicleTypeId, g]));
    const vehicleMap = new Map(
      vehicleGroups.map((g) => [g.vehicleTypeId, g._count._all]),
    );

    const perType: TypeStat[] = typeRows.map((t) => {
      const g = tripMap.get(t.id);
      return {
        vehicleTypeId: t.id,
        name: t.name,
        trips: g?._count._all ?? 0,
        revenue: this.num(g?._sum.fare),
        avgFare: this.num(g?._avg.fare),
        drivers: vehicleMap.get(t.id) ?? 0,
      };
    });

    const used = perType.filter((p) => p.trips > 0);
    const mostUsed =
      used.length > 0
        ? used.reduce((a, b) => (b.trips > a.trips ? b : a))
        : null;
    const leastUsed =
      used.length > 0
        ? used.reduce((a, b) => (b.trips < a.trips ? b : a))
        : null;
    const mostProfitable =
      used.length > 0
        ? used.reduce((a, b) => (b.revenue > a.revenue ? b : a))
        : null;

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        categories,
        types,
        publishedTypes,
        pricingRules,
        features,
        serviceAreas,
      },
      perType,
      mostUsed,
      leastUsed,
      mostProfitable,
    };
  }
}
