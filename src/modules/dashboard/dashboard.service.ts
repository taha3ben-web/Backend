import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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

    const sum = async (gte: Date) =>
      (
        await this.prisma.companyEarning.aggregate({
          _sum: { amount: true },
          where: { createdAt: { gte } },
        })
      )._sum.amount ?? 0;

    const [totalCompany, totalDriver] = await this.prisma.$transaction([
      this.prisma.companyEarning.aggregate({ _sum: { amount: true } }),
      this.prisma.driverEarning.aggregate({ _sum: { net: true } }),
    ]);

    return {
      totalCompany: totalCompany._sum.amount ?? 0,
      totalDriverPayouts: totalDriver._sum.net ?? 0,
      revenueToday: await sum(startDay),
      revenueWeek: await sum(startWeek),
      revenueMonth: await sum(startMonth),
    };
  }

  async latest() {
    const [trips, users, complaints, withdrawals] = await this.prisma.$transaction([
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

    const drivers: Array<{ id: string; lat: number; lng: number; heading: number }> = [];
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

    const [onlineDrivers, busyDrivers, activeTrips, openTickets, openComplaints, pendingWithdrawals, recentComplaints, recentWithdrawals, recentTrips] =
      await this.prisma.$transaction([
        this.prisma.driver.count({ where: { availability: "ONLINE" } }),
        this.prisma.driver.count({ where: { availability: "ON_TRIP" } }),
        this.prisma.trip.count({ where: { status: { in: ["ACCEPTED", "ARRIVING", "IN_PROGRESS"] } } }),
        this.prisma.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
        this.prisma.complaint.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
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

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private async checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
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
