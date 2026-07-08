import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DateRange, StatisticsService } from "./statistics.service";
import { buildExcel, ReportSheet } from "./generators/excel.generator";
import { buildPdf, PdfTable } from "./generators/pdf.generator";
import { ReportFormat, ReportType } from "./dto/reports.dto";

export interface GeneratedFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface Dataset {
  title: string;
  columns: Array<{ header: string; key: string; width: number }>;
  rows: Array<Record<string, unknown>>;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatisticsService,
  ) {}

  /** يولّد التقرير المطلوب بالصيغة المحددة */
  async generate(
    type: ReportType,
    range: DateRange,
    format: ReportFormat,
    limit = 20,
  ): Promise<GeneratedFile> {
    const dataset = await this.buildDataset(type, range, limit);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `nova-${type}-${stamp}`;

    if (format === ReportFormat.EXCEL) {
      const sheet: ReportSheet = {
        name: type.slice(0, 28),
        columns: dataset.columns,
        rows: dataset.rows,
      };
      const buffer = await buildExcel(dataset.title, [sheet]);
      return {
        buffer,
        filename: `${base}.xlsx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }

    const table: PdfTable = {
      heading: dataset.title,
      columns: dataset.columns,
      rows: dataset.rows,
    };
    const buffer = await buildPdf(dataset.title, [table]);
    return { buffer, filename: `${base}.pdf`, contentType: "application/pdf" };
  }

  private async buildDataset(
    type: ReportType,
    range: DateRange,
    limit: number,
  ): Promise<Dataset> {
    switch (type) {
      case ReportType.REVENUE:
        return this.revenueDataset(range);
      case ReportType.TRIPS:
        return this.tripsDataset(range, limit);
      case ReportType.DRIVERS:
        return this.driversDataset(limit);
      case ReportType.PASSENGERS:
        return this.passengersDataset(limit);
      case ReportType.TOP_DRIVERS:
        return this.topDriversDataset(range, limit);
      case ReportType.TOP_CITIES:
        return this.topCitiesDataset(range, limit);
      default:
        return this.revenueDataset(range);
    }
  }

  private async revenueDataset(range: DateRange): Promise<Dataset> {
    const r = await this.stats.revenue(range);
    const rows = [
      { metric: "إيرادات الشركة", value: r.companyEarnings },
      { metric: "العمولات", value: r.commissions },
      { metric: "إجمالي دخل السائقين (قبل العمولة)", value: r.driverGross },
      { metric: "صافي دخل السائقين", value: r.driverNet },
      { metric: "المدفوعات المحصّلة", value: r.paymentsCollected },
      { metric: "عمليات السحب المدفوعة", value: r.withdrawalsPaid },
    ];
    return {
      title: "تقرير الإيرادات",
      columns: [
        { header: "البند", key: "metric", width: 240 },
        { header: "القيمة (DZD)", key: "value", width: 140 },
      ],
      rows,
    };
  }

  private async tripsDataset(
    range: DateRange,
    limit: number,
  ): Promise<Dataset> {
    const createdAt = this.stats.range(range);
    const trips = await this.prisma.trip.findMany({
      where: { createdAt },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        passenger: { select: { name: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
    });
    const rows = trips.map((t) => ({
      id: t.id.slice(0, 8),
      status: t.status,
      passenger: t.passenger?.name ?? "—",
      driver: t.driver?.user.name ?? "—",
      distanceKm: t.distanceKm ?? 0,
      fare: t.fare ? Number(t.fare) : 0,
      createdAt: t.createdAt,
    }));
    return {
      title: "تقرير الرحلات",
      columns: [
        { header: "الرقم", key: "id", width: 70 },
        { header: "الحالة", key: "status", width: 80 },
        { header: "الراكب", key: "passenger", width: 90 },
        { header: "السائق", key: "driver", width: 90 },
        { header: "المسافة", key: "distanceKm", width: 60 },
        { header: "الأجرة", key: "fare", width: 70 },
        { header: "التاريخ", key: "createdAt", width: 110 },
      ],
      rows,
    };
  }

  private async driversDataset(limit: number): Promise<Dataset> {
    const drivers = await this.prisma.driver.findMany({
      take: limit,
      orderBy: { totalTrips: "desc" },
      include: { user: { select: { name: true, phone: true } } },
    });
    const rows = drivers.map((d) => ({
      name: d.user.name,
      phone: d.user.phone,
      status: d.status,
      availability: d.availability,
      rating: d.rating,
      totalTrips: d.totalTrips,
    }));
    return {
      title: "تقرير السائقين",
      columns: [
        { header: "الاسم", key: "name", width: 120 },
        { header: "الهاتف", key: "phone", width: 110 },
        { header: "الحالة", key: "status", width: 90 },
        { header: "التوفر", key: "availability", width: 80 },
        { header: "التقييم", key: "rating", width: 60 },
        { header: "الرحلات", key: "totalTrips", width: 60 },
      ],
      rows,
    };
  }

  private async passengersDataset(limit: number): Promise<Dataset> {
    const passengers = await this.prisma.user.findMany({
      where: { type: "PASSENGER" },
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        name: true,
        phone: true,
        status: true,
        createdAt: true,
        _count: { select: { passengerTrips: true } },
      },
    });
    const rows = passengers.map((p) => ({
      name: p.name,
      phone: p.phone,
      status: p.status,
      trips: p._count.passengerTrips,
      createdAt: p.createdAt,
    }));
    return {
      title: "تقرير الركاب",
      columns: [
        { header: "الاسم", key: "name", width: 130 },
        { header: "الهاتف", key: "phone", width: 120 },
        { header: "الحالة", key: "status", width: 90 },
        { header: "الرحلات", key: "trips", width: 70 },
        { header: "تاريخ التسجيل", key: "createdAt", width: 120 },
      ],
      rows,
    };
  }

  private async topDriversDataset(
    range: DateRange,
    limit: number,
  ): Promise<Dataset> {
    const top = await this.stats.topDrivers(range, limit);
    return {
      title: "أفضل السائقين",
      columns: [
        { header: "الاسم", key: "name", width: 130 },
        { header: "الهاتف", key: "phone", width: 120 },
        { header: "التقييم", key: "rating", width: 60 },
        { header: "الرحلات", key: "trips", width: 70 },
        { header: "صافي الأرباح", key: "netEarnings", width: 100 },
      ],
      rows: top,
    };
  }

  private async topCitiesDataset(
    range: DateRange,
    limit: number,
  ): Promise<Dataset> {
    const top = await this.stats.topCities(range, limit);
    return {
      title: "أكثر المدن نشاطًا",
      columns: [
        { header: "المدينة", key: "name", width: 180 },
        { header: "عدد الرحلات", key: "trips", width: 120 },
      ],
      rows: top,
    };
  }
}
