import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TripStatus, ActorKind } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RedisService } from "../redis/redis.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";
import { canTransition } from "./trip-transitions";

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly financial: FinancialService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async findAll(
    q: PaginationDto,
    status?: TripStatus,
    unsettledOnly = false,
    search?: string,
  ) {
    const where: Prisma.TripWhereInput = {
      ...(status ? { status } : {}),
      ...(unsettledOnly ? { status: "COMPLETED", settledAt: null } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: "insensitive" } },
              { passenger: { name: { contains: search, mode: "insensitive" } } },
              { passenger: { phone: { contains: search, mode: "insensitive" } } },
              { driver: { user: { name: { contains: search, mode: "insensitive" } } } },
              { driver: { user: { phone: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          passenger: { select: { name: true, phone: true } },
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        passenger: { select: { name: true, phone: true } },
        driver: { include: { user: { select: { name: true, phone: true } } } },
        tracking: { orderBy: { recordedAt: "asc" } },
        events: { orderBy: { createdAt: "asc" } },
        payment: true,
        driverEarning: true,
        companyEarning: true,
        ratings: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    return trip;
  }

  async changeStatus(
    id: string,
    to: TripStatus,
    reason?: string,
    actor: ActorKind = "STAFF",
  ) {
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip) throw new NotFoundException("Trip not found");
    if (!canTransition(trip.status, to)) {
      throw new BadRequestException(
        `Invalid transition ${trip.status} -> ${to}`,
      );
    }

    const guard = await this.prisma.trip.updateMany({
      where: { id, status: trip.status },
      data: {
        status: to,
        cancelReason: to === "CANCELLED" ? reason : undefined,
        cancelledBy: to === "CANCELLED" ? actor : undefined,
        startedAt: to === "IN_PROGRESS" ? new Date() : undefined,
        completedAt: to === "COMPLETED" ? new Date() : undefined,
      },
    });
    if (guard.count === 0) {
      throw new BadRequestException(
        `Invalid transition ${trip.status} -> ${to}`,
      );
    }
    await this.prisma.tripEvent.create({
      data: { tripId: id, type: `status:${to}`, actor },
    });

    if (to === "COMPLETED") {
      await this.settleCompletedTrip(id);
    }

    if (to === "COMPLETED" || to === "CANCELLED") {
      await this.releaseDriver(trip.driverId);
    }

    this.realtime.emitTripStatus(id, to);
    const updated = await this.prisma.trip.findUnique({ where: { id } });
    return updated ?? trip;
  }

  async retrySettlement(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        settledAt: true,
        settlementAttempts: true,
        settlementError: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.status !== "COMPLETED") {
      throw new BadRequestException("لا يمكن تسوية رحلة غير مكتملة");
    }
    if (trip.settledAt) {
      return { ok: true, alreadySettled: true };
    }
    await this.settleCompletedTrip(id);
    return this.findOne(id);
  }

  async driverChangeStatus(
    driverUserId: string,
    tripId: string,
    to: TripStatus,
    reason?: string,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, driver: { select: { userId: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (!trip.driver || trip.driver.userId !== driverUserId) {
      throw new ForbiddenException("لست السائق المكلّف بهذه الرحلة");
    }
    return this.changeStatus(tripId, to, reason, "DRIVER");
  }

  async isParticipant(tripId: string, userId: string): Promise<boolean> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { passengerId: true, driver: { select: { userId: true } } },
    });
    if (!trip) return false;
    return trip.passengerId === userId || trip.driver?.userId === userId;
  }

  private async releaseDriver(driverId: string | null): Promise<void> {
    if (!driverId) return;
    const driver = await this.prisma.driver
      .update({
        where: { id: driverId },
        data: { availability: "ONLINE" },
        select: { userId: true },
      })
      .catch(() => null);
    if (driver) {
      await this.redis.client
        .del(`driver:${driver.userId}:trip`)
        .catch(() => undefined);
    }
  }

  private async settleCompletedTrip(tripId: string): Promise<void> {
    await this.financial.settleTrip(tripId);
  }
}
