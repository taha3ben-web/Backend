import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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
import { DistributedLockService } from "../../common/infra/distributed-lock.service";

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
    private readonly cronLock: DistributedLockService,
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
    // DEFAULT_CURRENCY) بدل الاعتماد على أي عملة مثبتة افتراضيًا في
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

  /**
   * إلغاء رحلة مجدولة لمّا تزل في حالة SCHEDULED.
   *
   * لماذا CAS: التحديث المشروط هو ما يمنع الكتابة فوق رحلة تمّ
   * تفعيلها أو قبولها أو إكمالها. الملكية داخل الـ WHERE أيضًا حتى
   * لا يلغي مستخدم رحلة غيره بمجرد معرفة المعرّف.
   *
   * بعد التفعيل (SEARCHING فما بعدها) لا يُلغى من هنا إطلاقًا:
   * المسار المعتمد هو MatchingService.cancelSearch/passengerCancel أو
   * TripsService.changeStatus لأنها وحدها تنفّذ تحرير السائق والماليات
   * والأحداث والبث اللحظي.
   */
  async cancel(tripId: string, passengerId: string) {
    const guard = await this.prisma.trip.updateMany({
      where: {
        id: tripId,
        passengerId,
        isScheduled: true,
        status: "SCHEDULED",
      },
      data: { status: "CANCELLED", cancelledBy: "PASSENGER" },
    });
    // count === 0 يعني: غير موجودة أو ليست للمستخدم أو خرجت من SCHEDULED.
    // رد واحد للحالات الثلاث حتى لا يكشف وجود رحلات الآخرين.
    if (guard.count === 0) {
      throw new NotFoundException("الرحلة غير موجودة");
    }
    return this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { stops: { orderBy: { seq: "asc" } } },
    });
  }

  /** تفعيل الرحلات المجدولة التي حان وقت إرسالها. */
  @Cron("30 * * * * *")
  async activateDueTrips(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:scheduled-trips-activate",
      () => this.activateDueTripsTask(),
      55000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async activateDueTripsTask(): Promise<{ activated: number }> {
    const now = new Date();
    const due = await this.prisma.trip.findMany({
      where: {
        isScheduled: true,
        status: "SCHEDULED",
        dispatchAt: { lte: now },
      },
      take: 50,
    });
    let activated = 0;
    for (const trip of due) {
      // القفل الموزّع يمنع تزاحم نسخ الـ cron فقط، ولا يمنع إلغاءً
      // قادمًا من المستخدم بين الـ SELECT والـ UPDATE. الشرط في WHERE
      // هو ما يمنع إحياء رحلة أُلغيت (CANCELLED -> SEARCHING).
      const guard = await this.prisma.trip.updateMany({
        where: { id: trip.id, status: "SCHEDULED" },
        data: { status: "SEARCHING" },
      });
      if (guard.count === 0) {
        this.logger.log(
          `Skipped scheduled trip ${trip.id}: state changed before activation`,
        );
        continue;
      }
      activated += 1;
      this.logger.log(`Activated scheduled trip ${trip.id}`);
    }
    return { activated };
  }
}
