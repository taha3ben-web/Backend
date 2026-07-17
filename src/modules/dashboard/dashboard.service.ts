import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { FinancialService } from "../financial/financial.service";

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly financial: FinancialService,
  ) {}

  async summary() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      driversCount,
      passengersCount,
      tripsToday,
      activeTrips,
      cancelledToday,
      onlineDrivers,
      busyDrivers,
    ] = await this.prisma.$transaction([
      this.prisma.driver.count(),
      this.prisma.user.count({ where: { type: "PASSENGER" } }),
      this.prisma.trip.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.trip.count({
        where: { status: { in: ["ACCEPTED", "ARRIVING", "IN_PROGRESS"] } },
      }),
      this.prisma.trip.count({
        where: { status: "CANCELLED", createdAt: { gte: startOfDay } },
      }),
      this.prisma.driver.count({ where: { availability: "ONLINE" } }),
      this.prisma.driver.count({ where: { availability: "ON_TRIP" } }),
    ]);

    return {
      driversCount,
      passengersCount,
      tripsToday,
      activeTrips,
      cancelledToday,
      onlineDrivers,
      busyDrivers,
    };
  }

  async earnings() {
    const now = new Date();
    const startDay = new Date(now);
    startDay.setHours(0, 0, 0, 0);
    const startWeek = new Date(now);
    startWeek.setDate(now.getDate() - 7);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Revenue derived from the Ledger (single source of truth).
    const [totals, day, week, month] = await Promise.all([
      this.financial.getLedgerRevenue(),
      this.financial.getLedgerRevenue({ gte: startDay }),
      this.financial.getLedgerRevenue({ gte: startWeek }),
      this.financial.getLedgerRevenue({ gte: startMonth }),
    ]);

    return {
      totalCompany: totals.commission,
      totalDriverPayouts: totals.driverNet,
      revenueToday: day.commission,
      revenueWeek: week.commission,
      revenueMonth: month.commission,
    };
  }

  async latest() {
    const [trips, users, complaints, withdrawals] =
      await this.prisma.$transaction([
        this.prisma.trip.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
          include: { passenger: { select: { name: true } } },
        }),
        this.prisma.user.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, type: true, createdAt: true },
        }),
        this.prisma.complaint.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.withdrawRequest.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
        }),
      ]);
    return { trips, users, complaints, withdrawals };
  }

  async liveMap() {
    const ids = await this.redis.client.zrange("drivers:geo", 0, -1);
    if (ids.length === 0) return { drivers: [], count: 0 };

    const pipeline = this.redis.client.pipeline();
    for (const id of ids) pipeline.hgetall(`driver:${id}`);
    const res = await pipeline.exec();

    const drivers: Array<{
      id: string;
      lat: number;
      lng: number;
      heading: number;
    }> = [];
    ids.forEach((id, i) => {
      const h = res?.[i]?.[1] as Record<string, string> | null | undefined;
      if (h?.lat) {
        drivers.push({
          id,
          lat: Number(h.lat),
          lng: Number(h.lng),
          heading: Number(h.heading ?? 0),
        });
      }
    });
    return { drivers, count: drivers.length };
  }

  async operations() {
    const [db, redis, driversWithGeo] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.countGeoDrivers(),
    ]);

    const [
      onlineDrivers,
      busyDrivers,
      activeTrips,
      openTickets,
      openComplaints,
      pendingWithdrawals,
      recentComplaints,
      recentWithdrawals,
      recentTrips,
    ] = await this.prisma.$transaction([
      this.prisma.driver.count({ where: { availability: "ONLINE" } }),
      this.prisma.driver.count({ where: { availability: "ON_TRIP" } }),
      this.prisma.trip.count({
        where: { status: { in: ["ACCEPTED", "ARRIVING", "IN_PROGRESS"] } },
      }),
      this.prisma.supportTicket.count({
        where: { status: { in: ["OPEN", "PENDING"] } },
      }),
      this.prisma.complaint.count({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
      }),
      this.prisma.withdrawRequest.count({ where: { status: "PENDING" } }),
      this.prisma.complaint.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        include: {
          fromUser: { select: { name: true, phone: true } },
          againstUser: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.withdrawRequest.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, phone: true } } },
      }),
      this.prisma.trip.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: {
          passenger: { select: { name: true } },
          driver: { select: { user: { select: { name: true } } } },
        },
      }),
    ]);

    const memory = process.memoryUsage();

    return {
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMB: this.round2(memory.rss / 1048576),
        heapUsedMB: this.round2(memory.heapUsed / 1048576),
        heapTotalMB: this.round2(memory.heapTotal / 1048576),
      },
      health: { db, redis },
      queues: {
        driversWithGeo,
        onlineDrivers,
        busyDrivers,
        activeTrips,
        openTickets,
        openComplaints,
        pendingWithdrawals,
      },
      recentComplaints,
      recentWithdrawals,
      recentTrips,
    };
  }

  async readiness() {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      sessionCount,
      pendingSettingApprovals,
      activeFeatureFlags,
      publishedVehicleTypes,
      recentAuditEvents,
      recentActivityEvents,
      globalKill,
      configVersionSetting,
    ] = await this.prisma.$transaction([
      this.prisma.session.count(),
      this.prisma.settingChangeRequest.count({ where: { status: "PENDING" } }),
      this.prisma.featureFlag.count({ where: { enabled: true } }),
      this.prisma.vehicleType.count({
        where: { status: "PUBLISHED", isActive: true, deletedAt: null },
      }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.activityLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.featureFlagControl.findUnique({ where: { key: "global" } }),
      this.prisma.setting.findUnique({
        where: { key: "system.configVersion" },
        select: { value: true, publishedValue: true, updatedAt: true },
      }),
    ]);

    const alerts: string[] = [];
    if (!db.ok) alerts.push("قاعدة البيانات متأثرة");
    if (!redis.ok) alerts.push("Redis متأثر");
    if (globalKill?.globalKillSwitch) alerts.push("Global kill switch مفعّل");
    if (pendingSettingApprovals > 0)
      alerts.push("توجد طلبات إعدادات بانتظار المراجعة");
    if (publishedVehicleTypes === 0) alerts.push("لا توجد أنواع مركبات منشورة");

    return {
      ok: alerts.length === 0,
      ts: new Date().toISOString(),
      checks: { db, redis },
      counters: {
        sessionCount,
        pendingSettingApprovals,
        activeFeatureFlags,
        publishedVehicleTypes,
        recentAuditEvents,
        recentActivityEvents,
      },
      featureFlags: {
        globalKillSwitch: globalKill?.globalKillSwitch ?? false,
        globalKillReason: globalKill?.globalKillReason ?? null,
      },
      config: {
        value: configVersionSetting?.value ?? null,
        publishedValue: configVersionSetting?.publishedValue ?? null,
        updatedAt: configVersionSetting?.updatedAt ?? null,
      },
      alerts,
    };
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private async checkDb(): Promise<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
  }> {
    const start = Date.now();
    try {
      const pong = await this.redis.client.ping();
      return { ok: pong === "PONG", latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async countGeoDrivers(): Promise<number> {
    try {
      return await this.redis.client.zcard("drivers:geo");
    } catch {
      return -1;
    }
  }
}
