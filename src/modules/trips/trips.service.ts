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
import { computeSettlement } from "./settlement.util";

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
  private async settleCompletedTrip(tripId: string): Promise<void> {
    await this.financial.settleTrip(tripId);
  }
}
