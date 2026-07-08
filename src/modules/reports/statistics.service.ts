import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface DateRange {
  from?: string;
  to?: string;
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** يحوّل نطاقًا اختياريًا إلى فلتر createdAt (افتراضي: آخر 30 يومًا) */
  range(r: DateRange): { gte: Date; lte: Date } {
    const to = r.to ? new Date(r.to) : new Date();
    const from = r.from
      ? new Date(r.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte: from, lte: to };
  }

  /** ملخص عام للفترة */
  async overview(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalTrips,
      completedTrips,
      cancelledTrips,
      newPassengers,
      newDrivers,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { createdAt } }),
      this.prisma.trip.count({ where: { createdAt, status: "COMPLETED" } }),
      this.prisma.trip.count({ where: { createdAt, status: "CANCELLED" } }),
      this.prisma.user.count({ where: { createdAt, type: "PASSENGER" } }),
      this.prisma.driver.count({ where: { createdAt } }),
    ]);
    const completionRate =
      totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;
    return {
      range: createdAt,
      totalTrips,
      completedTrips,
      cancelledTrips,
      completionRate,
      newPassengers,
      newDrivers,
    };
  }

  /** ملخص الإيرادات والعمولات للفترة */
  async revenue(r: DateRange) {
    const createdAt = this.range(r);
    const [company, driver, payments, withdrawals] =
      await this.prisma.$transaction([
        this.prisma.companyEarning.aggregate({
          where: { createdAt },
          _sum: { amount: true },
        }),
        this.prisma.driverEarning.aggregate({
          where: { createdAt },
          _sum: { gross: true, commission: true, net: true },
        }),
        this.prisma.payment.aggregate({
          where: { createdAt, status: "PAID" },
          _sum: { amount: true },
        }),
        this.prisma.withdrawRequest.aggregate({
          where: { createdAt, status: "PAID" },
          _sum: { amount: true },
        }),
      ]);
    return {
      companyEarnings: this.num(company._sum.amount),
      driverGross: this.num(driver._sum.gross),
      commissions: this.num(driver._sum.commission),
      driverNet: this.num(driver._sum.net),
      paymentsCollected: this.num(payments._sum.amount),
      withdrawalsPaid: this.num(withdrawals._sum.amount),
    };
  }

  /** أفضل السائقين حسب صافي الأرباح في الفترة */
  async topDrivers(r: DateRange, limit = 10) {
    const createdAt = this.range(r);
    const grouped = await this.prisma.driverEarning.groupBy({
      by: ["driverId"],
      where: { createdAt },
      _sum: { net: true },
      _count: { tripId: true },
      orderBy: { _sum: { net: "desc" } },
      take: limit,
    });
    const ids = grouped.map((g) => g.driverId);
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { name: true, phone: true } } },
    });
    const map = new Map(drivers.map((d) => [d.id, d]));
    return grouped.map((g) => ({
      driverId: g.driverId,
      name: map.get(g.driverId)?.user.name ?? "—",
      phone: map.get(g.driverId)?.user.phone ?? "—",
      rating: map.get(g.driverId)?.rating ?? 0,
      trips: g._count.tripId,
      netEarnings: this.num(g._sum.net),
    }));
  }

  /** أكثر المدن نشاطًا (عدد الرحلات) */
  async topCities(r: DateRange, limit = 10) {
    const createdAt = this.range(r);
    const grouped = await this.prisma.trip.groupBy({
      by: ["cityId"],
      where: { createdAt, cityId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });
    const ids = grouped
      .map((g) => g.cityId)
      .filter((c): c is string => c != null);
    const cities = await this.prisma.city.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const map = new Map(cities.map((c) => [c.id, c.name]));
    return grouped.map((g) => ({
      cityId: g.cityId,
      name: g.cityId ? (map.get(g.cityId) ?? "—") : "—",
      trips: g._count.id,
    }));
  }

  /** سلسلة زمنية يومية للرحلات والإيرادات (للرسوم البيانية) */
  async timeseries(r: DateRange) {
    const { gte, lte } = this.range(r);
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; trips: bigint; revenue: Prisma.Decimal | null }>
    >`
      SELECT date_trunc('day', t."createdAt") AS day,
             COUNT(t.id) AS trips,
             COALESCE(SUM(ce.amount), 0) AS revenue
      FROM "Trip" t
      LEFT JOIN "CompanyEarning" ce ON ce."tripId" = t.id
      WHERE t."createdAt" >= ${gte} AND t."createdAt" <= ${lte}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      trips: Number(row.trips),
      revenue: this.num(row.revenue),
    }));
  }

  private num(v: Prisma.Decimal | null | undefined): number {
    return v ? Number(v) : 0;
  }
}
