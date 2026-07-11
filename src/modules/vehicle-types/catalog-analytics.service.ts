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
 * تحليلات الكتالوج للوحة (أكثر من مجرّد CRUD):
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

  /**
   * يحوّل قيمة رقمية قد تكون number أو string أو Prisma.Decimal (التي
   * توفّر toNumber()) إلى number آمن دون أي تحويل غير آمن.
   */
  private num(
    v: number | string | { toNumber(): number } | null | undefined,
  ): number {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v) || 0;
    return v.toNumber();
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
    ]);

    // نحسب التحليلات عبر findMany ثم تجميع في الذاكرة بدلاً من groupBy.
    // هذه الطريقة الرسمية تعيد أنواعًا قياسية ثابتة (حقول النموذج)
    // بدلاً من أشكال _count/_sum/_avg المشروطة بوسائط التحديد، فتبقى
    // متوافقة مع أي إصدار Prisma دون تحويلات. والنتيجة مخزّنة مؤقتًا.
    const [completedTrips, activeVehicles] = await Promise.all([
      this.prisma.trip.findMany({
        where: { status: "COMPLETED", vehicleTypeId: { not: null } },
        select: { vehicleTypeId: true, fare: true },
      }),
      this.prisma.vehicle.findMany({
        where: { isActive: true, vehicleTypeId: { not: null } },
        select: { vehicleTypeId: true },
      }),
    ]);

    const tripAgg = new Map<string, { trips: number; revenue: number }>();
    for (const t of completedTrips) {
      if (!t.vehicleTypeId) continue;
      const cur = tripAgg.get(t.vehicleTypeId) ?? { trips: 0, revenue: 0 };
      cur.trips += 1;
      cur.revenue += this.num(t.fare);
      tripAgg.set(t.vehicleTypeId, cur);
    }

    const driverCount = new Map<string, number>();
    for (const v of activeVehicles) {
      if (!v.vehicleTypeId) continue;
      driverCount.set(
        v.vehicleTypeId,
        (driverCount.get(v.vehicleTypeId) ?? 0) + 1,
      );
    }

    const perType: TypeStat[] = typeRows.map((t) => {
      const agg = tripAgg.get(t.id);
      const trips = agg ? agg.trips : 0;
      const revenue = agg ? agg.revenue : 0;
      return {
        vehicleTypeId: t.id,
        name: t.name,
        trips,
        revenue,
        avgFare: trips > 0 ? revenue / trips : 0,
        drivers: driverCount.get(t.id) ?? 0,
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
