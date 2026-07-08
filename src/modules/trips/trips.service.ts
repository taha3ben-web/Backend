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
import { WalletService } from "../payments/wallet.service";
import { canTransition } from "./trip-transitions";
import { computeSettlement } from "./settlement.util";

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly wallet: WalletService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async findAll(q: PaginationDto, status?: TripStatus) {
    const where: Prisma.TripWhereInput = status ? { status } : {};
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

    // انتقال ذري: لا نحدّث إلا إن بقيت الحالة كما قرأناها (compare-and-set).
    // يمنع تسابق انتقالين متزامنين من نفس الحالة
    // (مثل COMPLETED من السائق وCANCELLED من الموظف) من النجاح معًا.
    // ملاحظة: undefined يعني "لا تغيّر" في Prisma — فيحافظ على القيم السابقة.
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
      // خسرنا التسابق: تغيّرت الحالة بين القراءة والكتابة.
      throw new BadRequestException(
        `Invalid transition ${trip.status} -> ${to}`,
      );
    }
    await this.prisma.tripEvent.create({
      data: { tripId: id, type: `status:${to}`, actor },
    });

    // تسوية الرحلة ماليًا عند الاكتمال
    if (to === "COMPLETED") {
      await this.settleCompletedTrip(id);
    }

    // تحرير السائق عند انتهاء الرحلة (اكتمال أو إلغاء)
    if (to === "COMPLETED" || to === "CANCELLED") {
      await this.releaseDriver(trip.driverId);
    }

    this.realtime.emitTripStatus(id, to);
    const updated = await this.prisma.trip.findUnique({ where: { id } });
    return updated ?? trip;
  }

  /**
   * تغيير حالة الرحلة من طرف السائق المكلّف بها (عبر WebSocket).
   * يتحقق من ملكية الرحلة قبل السماح بالانتقال، ويسجّل الفاعل DRIVER.
   */
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

  /**
   * هل المستخدم طرفٌ في الرحلة (الراكب أو السائق المكلّف)؟
   * استعلام خفيف يُستخدم لحماية الانضمام إلى غرف WebSocket (trip:{id})
   * من الوصول غير المصرّح (IDOR).
   */
  async isParticipant(tripId: string, userId: string): Promise<boolean> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { passengerId: true, driver: { select: { userId: true } } },
    });
    if (!trip) return false;
    return trip.passengerId === userId || trip.driver?.userId === userId;
  }

  /** يعيد السائق إلى حالة ONLINE ويحرّر مفتاح رحلته في Redis */
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

  /**
   * توزيع الأرباح عند اكتمال الرحلة (ذريًا ومرة واحدة):
   * - تسجيل الدفعة (إن لم توجد) حسب طريقة دفع الرحلة.
   * - حساب عمولة الشركة وصافي السائق.
   * - إضافة صافي السائق إلى محفظته (منها يطلب السحب).
   */
  private async settleCompletedTrip(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driverEarning: true },
    });
    if (!trip || !trip.driverId || trip.fare == null) return;
    if (trip.driverEarning) return; // تمت التسوية مسبقًا

    const rate = this.config.get<number>("companyCommission") ?? 0.15;
    const { gross, commission, net } = computeSettlement(
      Number(trip.fare),
      rate,
    );
    const driverId = trip.driverId;

    await this.prisma.$transaction(async (client) => {
      // دفعة الراكب (إن لم توجد)
      const existingPayment = await client.payment.findUnique({
        where: { tripId },
      });
      if (!existingPayment) {
        const paidNow = trip.paymentMethod === "WALLET";
        if (paidNow) {
          await this.wallet.adjust(
            trip.passengerId,
            "DEBIT",
            gross,
            `دفع رحلة ${tripId}`,
            client,
          );
        }
        await client.payment.create({
          data: {
            tripId,
            userId: trip.passengerId,
            amount: gross,
            method: trip.paymentMethod,
            status: paidNow ? "PAID" : "PENDING",
          },
        });
      }

      // أرباح السائق + عمولة الشركة
      await client.driverEarning.create({
        data: { driverId, tripId, gross, commission, net },
      });
      await client.companyEarning.create({
        data: { tripId, amount: commission, source: "commission" },
      });

      // إضافة صافي الربح لمحفظة السائق
      const driver = await client.driver.findUnique({
        where: { id: driverId },
        select: { userId: true },
      });
      if (driver) {
        await this.wallet.adjust(
          driver.userId,
          "CREDIT",
          net,
          `صافي أرباح رحلة ${tripId}`,
          client,
        );
      }

      // تحديث عدّاد رحلات السائق
      await client.driver.update({
        where: { id: driverId },
        data: { totalTrips: { increment: 1 } },
      });
    });
  }
}
