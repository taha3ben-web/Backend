import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { CountryConfigService } from "../country-config/country-config.service";
import {
  validateScheduledTime,
  validateStops,
  dispatchAtMs,
  orderStops,
  totalRouteDistanceKm,
  TripStopInput,
} from "./scheduling.util";

export interface CreateScheduledTripInput {
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress?: string;
  scheduledAt: string | Date;
  rideClass?: string;
  cityId?: string;
  leadMinutes?: number;
  stops?: TripStopInput[];
}

@Injectable()
export class ScheduledTripsService {
  private readonly logger = new Logger(ScheduledTripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly countryConfig: CountryConfigService,
  ) {}

  /** ينشئ رحلة مجدولة (مع توقفات اختيارية) ويحسب وقت الإرسال. */
  async create(input: CreateScheduledTripInput) {
    const scheduledAtMs = new Date(input.scheduledAt).getTime();
    const check = validateScheduledTime(scheduledAtMs, Date.now());
    if (!check.valid) {
      throw new BadRequestException(`SCHEDULE_${check.reason}`);
    }

    const stops = input.stops ?? [];
    if (stops.length > 0) {
      const stopCheck = validateStops(stops);
      if (!stopCheck.valid) {
        throw new BadRequestException(`STOPS_${stopCheck.reason}`);
      }
    }

    const dispatch = new Date(dispatchAtMs(scheduledAtMs, input.leadMinutes));
    const ordered = orderStops(stops);
    const lastStop = ordered[ordered.length - 1];
    const distanceKm =
      stops.length > 0
        ? totalRouteDistanceKm(
            { lat: input.pickupLat, lng: input.pickupLng },
            stops,
          )
        : null;

    // Stage 50: اشتقاق العملة من دولة المدينة (أو الافتراض المركزي
    // DEFAULT_CURRENCY) بدل الاعتماد على أي عملة مثبّتة افتراضيًا في
    // قاعدة البيانات، لدعم تعدّد العملات فعليًا.
    const city = input.cityId
      ? await this.prisma.city.findUnique({
          where: { id: input.cityId },
          select: { country: true },
        })
      : null;
    const currency = await this.countryConfig.currencyFor(city?.country ?? "");

    return this.prisma.trip.create({
      data: {
        passengerId: input.passengerId,
        status: "SCHEDULED",
        rideClass: (input.rideClass as any) ?? "ECONOMY",
        currency,
        cityId: input.cityId ?? null,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        pickupAddress: input.pickupAddress ?? null,
        destLat: lastStop?.lat ?? null,
        destLng: lastStop?.lng ?? null,
        destAddress: lastStop?.address ?? null,
        distanceKm,
        isScheduled: true,
        scheduledAt: new Date(scheduledAtMs),
        dispatchAt: dispatch,
        stops: {
          create: ordered.map((s) => ({
            seq: s.seq,
            lat: s.lat,
            lng: s.lng,
            address: s.address ?? null,
          })),
        },
      },
      include: { stops: { orderBy: { seq: "asc" } } },
    });
  }

  async listUpcoming(passengerId?: string) {
    return this.prisma.trip.findMany({
      where: {
        isScheduled: true,
        status: "SCHEDULED",
        ...(passengerId ? { passengerId } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      include: { stops: { orderBy: { seq: "asc" } } },
      take: 100,
    });
  }

  async cancel(tripId: string) {
    return this.prisma.trip.update({
      where: { id: tripId },
      data: { status: "CANCELLED", cancelledBy: "PASSENGER" },
    });
  }

  /** تفعيل الرحلات المجدولة التي حان وقت إرسالها. */
  @Cron("30 * * * * *")
  async activateDueTrips() {
    const now = new Date();
    const due = await this.prisma.trip.findMany({
      where: {
        isScheduled: true,
        status: "SCHEDULED",
        dispatchAt: { lte: now },
      },
      take: 50,
    });
    for (const trip of due) {
      await this.prisma.trip.update({
        where: { id: trip.id },
        data: { status: "SEARCHING" },
      });
      this.logger.log(`Activated scheduled trip ${trip.id}`);
    }
    return { activated: due.length };
  }
}
