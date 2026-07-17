import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  canAcceptTrip,
  canChangeLaunchStatus,
  driverUtilization,
  effectiveSurgeMultiplier,
  CityLaunchStatus,
  CityScalingControl,
} from "./city-scaling.util";

export interface UpsertControlInput {
  cityId: string;
  launchStatus?: CityLaunchStatus;
  maxActiveDrivers?: number | null;
  maxDailyTrips?: number | null;
  enabledRideClasses?: string[];
  surgeCap?: number | null;
  notes?: string;
}

@Injectable()
export class CityScalingService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: UpsertControlInput, updatedBy?: string) {
    const control = await this.prisma.cityScalingControl.upsert({
      where: { cityId: input.cityId },
      create: {
        cityId: input.cityId,
        launchStatus: (input.launchStatus as any) ?? "PLANNED",
        maxActiveDrivers: input.maxActiveDrivers ?? null,
        maxDailyTrips: input.maxDailyTrips ?? null,
        enabledRideClasses: input.enabledRideClasses ?? [],
        surgeCap: input.surgeCap ?? null,
        notes: input.notes ?? null,
        createdBy: updatedBy ?? null,
      },
      update: {
        maxActiveDrivers: input.maxActiveDrivers ?? undefined,
        maxDailyTrips: input.maxDailyTrips ?? undefined,
        enabledRideClasses: input.enabledRideClasses ?? undefined,
        surgeCap: input.surgeCap ?? undefined,
        notes: input.notes ?? undefined,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: updatedBy ?? null,
        action: "CITY_SCALING_CONTROL_UPDATED",
        entity: "CityScalingControl",
        entityId: control.id,
        meta: {
          cityId: input.cityId,
          maxActiveDrivers: control.maxActiveDrivers,
          maxDailyTrips: control.maxDailyTrips,
          enabledRideClasses: control.enabledRideClasses,
          surgeCap: control.surgeCap,
        },
      },
    });
    return control;
  }

  /** تغيير حالة إطلاق المدينة مع حراسة الانتقالات. */
  async changeLaunchStatus(
    cityId: string,
    to: CityLaunchStatus,
    actorId?: string,
  ) {
    const control = await this.prisma.cityScalingControl.findUniqueOrThrow({
      where: { cityId },
    });
    if (!canChangeLaunchStatus(control.launchStatus as CityLaunchStatus, to)) {
      throw new BadRequestException(
        `ILLEGAL_LAUNCH_TRANSITION_${control.launchStatus}_TO_${to}`,
      );
    }
    const updated = await this.prisma.cityScalingControl.update({
      where: { cityId },
      data: { launchStatus: to as any },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action: "CITY_LAUNCH_STATUS_CHANGED",
        entity: "CityScalingControl",
        entityId: updated.id,
        meta: { cityId, from: control.launchStatus, to },
      },
    });
    return updated;
  }

  async get(cityId: string) {
    return this.prisma.cityScalingControl.findUnique({ where: { cityId } });
  }

  async list() {
    return this.prisma.cityScalingControl.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
  }

  private toControl(row: {
    launchStatus: string;
    maxActiveDrivers: number | null;
    maxDailyTrips: number | null;
    enabledRideClasses: string[];
    surgeCap: number | null;
  }): CityScalingControl {
    return {
      launchStatus: row.launchStatus as CityLaunchStatus,
      maxActiveDrivers: row.maxActiveDrivers,
      maxDailyTrips: row.maxDailyTrips,
      enabledRideClasses: row.enabledRideClasses,
      surgeCap: row.surgeCap,
    };
  }

  /** يقيّم إمكانية قبول رحلة جديدة في المدينة بناءً على السعة الحالية. */
  async evaluateAcceptance(cityId: string, rideClass: string) {
    const control = await this.prisma.cityScalingControl.findUnique({
      where: { cityId },
    });
    if (!control) {
      // لا يوجد ضابط => السلوك الافتراضي: القبول.
      return { accept: true, reason: "NO_CONTROL" };
    }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [activeDrivers, dailyTrips] = await Promise.all([
      this.prisma.driver.count({
        where: { cityId, availability: "AVAILABLE" as any },
      }),
      this.prisma.trip.count({
        where: { cityId, createdAt: { gte: startOfDay } },
      }),
    ]);
    const model = this.toControl(control);
    const decision = canAcceptTrip(
      model,
      { activeDrivers, dailyTrips },
      rideClass,
    );
    return {
      ...decision,
      utilization: driverUtilization(model, { activeDrivers, dailyTrips }),
      activeDrivers,
      dailyTrips,
    };
  }

  /** سقف مضاعف الذروة الفعّال للمدينة. */
  async cappedSurge(cityId: string, requested: number) {
    const control = await this.prisma.cityScalingControl.findUnique({
      where: { cityId },
    });
    if (!control) return Math.max(1, requested);
    return effectiveSurgeMultiplier(this.toControl(control), requested);
  }
}
