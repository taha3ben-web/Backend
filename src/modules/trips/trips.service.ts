import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma, TripStatus, ActorKind } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RedisService } from "../redis/redis.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";
import { canTransition } from "./trip-transitions";
import { NotificationsService } from "../notifications/notifications.service";
import { SettingsService } from "../settings/settings.service";
import { RouteDeviationService } from "./route-deviation.service";
import { InvoicesService } from "../invoices/invoices.service";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { ReferralService } from "../referral/referral.service";
import { TransactionalEmailService } from "../notifications/transactional-email.service";
import { formatEmailAmount } from "../notifications/transactional-email.util";

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly financial: FinancialService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly deviation: RouteDeviationService,
    private readonly invoices: InvoicesService,
    private readonly loyalty: LoyaltyService,
    private readonly referral: ReferralService,
    private readonly mailer: TransactionalEmailService,
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

  /**
   * مؤشرات التوجيه والمطابقة (قراءة فقط) مشتقة من TripEvent وحالات الرحلات.
   * لا تعدّل أي بيانات ولا تؤثر على محرك المطابقة.
   */
  async dispatchMetrics(fromISO?: string, toISO?: string) {
    const to = toISO ? new Date(toISO) : new Date();
    const from = fromISO
      ? new Date(fromISO)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const createdAt = { gte: from, lte: to };

    const [requested, noDrivers, searchTimeout, accepted, cancelledEvents] =
      await this.prisma.$transaction([
        this.prisma.tripEvent.count({
          where: { type: "trip:requested", createdAt },
        }),
        this.prisma.tripEvent.count({
          where: { type: "trip:no_drivers", createdAt },
        }),
        this.prisma.tripEvent.count({
          where: { type: "trip:search_timeout", createdAt },
        }),
        this.prisma.tripEvent.count({
          where: { type: "trip:accepted", createdAt },
        }),
        this.prisma.tripEvent.count({
          where: { type: "trip:cancelled", createdAt },
        }),
      ]);

    const [totalTrips, completed, cancelledTrips, activeSearching] =
      await this.prisma.$transaction([
        this.prisma.trip.count({ where: { createdAt } }),
        this.prisma.trip.count({ where: { createdAt, status: "COMPLETED" } }),
        this.prisma.trip.count({ where: { createdAt, status: "CANCELLED" } }),
        this.prisma.trip.count({ where: { createdAt, status: "SEARCHING" } }),
      ]);

    const matchRate =
      requested > 0 ? Math.round((accepted / requested) * 100) : 0;
    const unservedRate =
      requested > 0
        ? Math.round(((noDrivers + searchTimeout) / requested) * 100)
        : 0;

    const recentFailures = await this.prisma.tripEvent.findMany({
      where: {
        type: { in: ["trip:no_drivers", "trip:search_timeout"] },
        createdAt,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        trip: {
          select: {
            id: true,
            rideClass: true,
            pickupAddress: true,
            city: { select: { name: true } },
          },
        },
      },
    });

    return {
      range: { from, to },
      events: { requested, noDrivers, searchTimeout, accepted, cancelledEvents },
      rates: { matchRate, unservedRate },
      funnel: { totalTrips, completed, cancelledTrips, activeSearching },
      recentFailures,
    };
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
        settlementStatus: to === "COMPLETED" ? "PENDING" : undefined,
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
      this.deviation.forget(id);
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
      select: {
        id: true,
        passengerId: true,
        driver: { select: { userId: true } },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (!trip.driver || trip.driver.userId !== driverUserId) {
      throw new ForbiddenException("لست السائق المكلّف بهذه الرحلة");
    }
    const result = await this.changeStatus(tripId, to, reason, "DRIVER");
    this.notifyTripPush(trip.passengerId, tripId, to);
    return result;
  }

  /**
   * إشعار Push للراكب عند تغيّر حالة الرحلة من طرف السائق (أفضل-جهد).
   * الإرسال fire-and-forget؛ فشل الإشعار لا يكسر انتقال الحالة إطلاقًا.
   */
  private notifyTripPush(
    passengerId: string,
    tripId: string,
    to: TripStatus,
  ): void {
    void this.sendTripPush(passengerId, tripId, to).catch((err: unknown) =>
      this.logger.warn(
        `فشل إرسال إشعار Push للرحلة ${tripId}: ${(err as Error).message}`,
      ),
    );
  }

  private async sendTripPush(passengerId: string, tripId: string, to: TripStatus) {
    const user = await this.prisma.user.findUnique({ where: { id: passengerId }, select: { locale: true } });
    const templates = await this.settings.getValue<Record<string, Partial<Record<TripStatus, { title: string; body: string }>>>>("passenger.tripStatusNotifications");
    const locale = user?.locale ?? "ar";
    const msg = templates?.[locale]?.[to] ?? templates?.ar?.[to];
    if (!msg?.title || !msg?.body) return;
    await this.notifications.notifyUser(passengerId, msg.title, msg.body, "PUSH", {
        kind: "trip",
        tripId,
        status: to,
      });
  }

  /**
   * حفظ نقطة تتبّع GPS للرحلة (أفضل-جهد). يُستدعى من WebSocket gateway
   * بشكل مُقنّن أثناء الرحلة النشطة؛ الفشل لا يؤثّر على البثّ الحي.
   */
  async recordTracking(
    tripId: string,
    point: { lat: number; lng: number; heading?: number; speed?: number },
  ): Promise<void> {
    await this.prisma.tripTracking
      .create({
        data: {
          tripId,
          lat: point.lat,
          lng: point.lng,
          heading: point.heading ?? null,
          speed: point.speed ?? null,
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `فشل حفظ نقطة تتبّع للرحلة ${tripId}: ${(err as Error).message}`,
        ),
      );
    // فحص انحراف المسار (أفضل-جهد): لا يحجب البثّ الحيّ ولا يرمي.
    void this.deviation
      .check(tripId, { lat: point.lat, lng: point.lng })
      .catch(() => undefined);
  }

  /**
   * جلب مسار الرحلة المحفوظ (نقاط GPS) بعد التحقّق من ملكية السائق.
   */
  async getTripTrack(driverUserId: string, tripId: string, limit = 1000) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, driver: { select: { userId: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    if (!trip.driver || trip.driver.userId !== driverUserId) {
      throw new ForbiddenException("لست السائق المكلّف بهذه الرحلة");
    }
    return this.prisma.tripTracking.findMany({
      where: { tripId },
      orderBy: { recordedAt: "asc" },
      take: limit,
      select: {
        lat: true,
        lng: true,
        heading: true,
        speed: true,
        recordedAt: true,
      },
    });
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
    await this.issueInvoiceQuietly(tripId);
    await this.grantTripRewardsQuietly(tripId);
    await this.emailTripReceiptQuietly(tripId);
  }

  /**
   * إيصال الرحلة بالبريد — أفضل جهد ولا يرمي أبدًا.
   *
   * منفصل عن بريد الفاتورة: الإيصال يُرسل دائمًا بعد التسوية، أمّا
   * الفاتورة فمستند رسمي قد يفشل إصداره لأسباب تخزين.
   */
  private async emailTripReceiptQuietly(tripId: string): Promise<void> {
    const trip = await this.prisma.trip
      .findUnique({
        where: { id: tripId },
        select: {
          passengerId: true,
          fare: true,
          currency: true,
          completedAt: true,
        },
      })
      .catch(() => null);
    if (!trip) return;
    this.mailer.fireAndForget({
      userId: trip.passengerId,
      template: "trip_receipt",
      vars: {
        tripId,
        amount: formatEmailAmount(trip.fare),
        currency: trip.currency,
        date: (trip.completedAt ?? new Date()).toISOString().slice(0, 10),
      },
    });
  }

  /**
   * إصدار الفاتورة تلقائيًا بعد التسوية — أفضل جهد لا غير.
   *
   * الفاتورة مستند ثانوي؛ فشل إصدارها (انقطاع التخزين مثلًا) يجب ألا يُرجع
   * تسوية مالية نجحت فعلًا. ولأنّ `issueForTrip` خامل التكرار، يمكن للراكب
   * طلبها لاحقًا من التطبيق فتُنشأ حينها دون ازدواج.
   */
  private async issueInvoiceQuietly(tripId: string): Promise<void> {
    try {
      const invoice = await this.invoices.issueForTrip(tripId);
      this.logger.log(`فاتورة ${invoice.number} للرحلة ${tripId}`);
    } catch (error) {
      this.logger.warn(
        `تعذر إصدار فاتورة الرحلة ${tripId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * مكافآت ما بعد الرحلة: نقاط الولاء وتأهّل الإحالة — أفضل جهد.
   *
   * كلتا الدالتين خاملتا التكرار (مفتاح لكل رحلة / لكل إحالة)، لذلك لا ضرر من
   * إعادة المحاولة. ولا يجوز لفشلهما أن يُرجِع تسوية مالية نجحت فعلًا.
   */
  private async grantTripRewardsQuietly(tripId: string): Promise<void> {
    const trip = await this.prisma.trip
      .findUnique({
        where: { id: tripId },
        select: { passengerId: true, fare: true },
      })
      .catch(() => null);
    if (!trip) return;

    try {
      const points = await this.loyalty.earnFromTrip(
        trip.passengerId,
        trip.fare ? Number(trip.fare) : 0,
        tripId,
      );
      if (points > 0) {
        this.logger.log(`نقاط ولاء ${points} للرحلة ${tripId}`);
      }
    } catch (error) {
      this.logger.warn(
        `تعذر منح نقاط الولاء للرحلة ${tripId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const result = await this.referral.qualifyReferral(trip.passengerId);
      if (result.rewarded) {
        this.logger.log(
          `تأهّلت إحالة الراكب ${trip.passengerId} بعد الرحلة ${tripId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `تعذر تأهيل الإحالة للرحلة ${tripId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
