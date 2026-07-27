import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { FinancialService } from "../financial/financial.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  TIP_MAX_AMOUNT,
  TIP_MIN_AMOUNT,
  TIP_PRESETS,
  TIP_WINDOW_HOURS,
  isWithinTipWindow,
  tipIdempotencyKey,
  tipRejectionMessage,
  validateTipAmount,
} from "./tips.util";
import { SendTipDto } from "./dto/tip.dto";

/**
 * إكراميات الراكب للسائق. المبلغ يُحوّل بقيد مزدوج متوازن من محفظة الراكب إلى
 * محفظة السائق دون أي عمولة للمنصّة، وإكرامية واحدة فقط لكل رحلة.
 */
@Injectable()
export class TipsService {
  private readonly logger = new Logger("Tips");

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
    private readonly notifications: NotificationsService,
  ) {}

  /** الإعدادات التي يقرأها التطبيق لبناء شاشة الإكرامية. */
  config() {
    return {
      presets: TIP_PRESETS,
      minAmount: TIP_MIN_AMOUNT,
      maxAmount: TIP_MAX_AMOUNT,
      windowHours: TIP_WINDOW_HOURS,
    };
  }

  /** إرسال إكرامية عن رحلة مكتملة من محفظة الراكب. */
  async send(passengerUserId: string, tripId: string, dto: SendTipDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        passengerId: true,
        driverId: true,
        status: true,
        currency: true,
        completedAt: true,
        driver: { select: { userId: true } },
        tip: { select: { id: true } },
      },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.passengerId !== passengerUserId) {
      throw new NotFoundException("الرحلة غير موجودة");
    }
    if (trip.tip) {
      throw new ConflictException("تم إرسال إكرامية لهذه الرحلة مسبقًا");
    }
    if (trip.status !== TripStatus.COMPLETED) {
      throw new BadRequestException(tipRejectionMessage("NOT_COMPLETED"));
    }
    if (!isWithinTipWindow(trip.completedAt)) {
      throw new BadRequestException(tipRejectionMessage("WINDOW_EXPIRED"));
    }
    const driverUserId = trip.driver?.userId;
    if (!trip.driverId || !driverUserId) {
      throw new BadRequestException("لا يوجد سائق مرتبط بهذه الرحلة");
    }
    const rejection = validateTipAmount(dto.amount);
    if (rejection) {
      throw new BadRequestException(tipRejectionMessage(rejection));
    }

    const tip = await this.prisma.$transaction(async (tx) => {
      await this.financial.transferTip(tx, {
        fromUserId: passengerUserId,
        toUserId: driverUserId,
        amount: dto.amount,
        currency: trip.currency,
        tripId: trip.id,
        idempotencyKey: tipIdempotencyKey(trip.id),
      });
      return tx.tripTip.create({
        data: {
          tripId: trip.id,
          fromUserId: passengerUserId,
          toUserId: driverUserId,
          amount: dto.amount,
          currency: trip.currency,
          note: dto.note ?? null,
        },
        select: {
          id: true,
          tripId: true,
          amount: true,
          currency: true,
          status: true,
          note: true,
          createdAt: true,
        },
      });
    });

    this.notifyDriverQuietly(driverUserId, dto.amount, trip.currency);
    return tip;
  }

  /** إكرامية رحلة واحدة (للراكب أو للسائق صاحبها). */
  async forTrip(userId: string, tripId: string) {
    const tip = await this.prisma.tripTip.findUnique({
      where: { tripId },
      select: {
        id: true,
        tripId: true,
        amount: true,
        currency: true,
        status: true,
        note: true,
        createdAt: true,
        fromUserId: true,
        toUserId: true,
      },
    });
    if (!tip) return null;
    if (tip.fromUserId !== userId && tip.toUserId !== userId) {
      throw new NotFoundException("لا توجد إكرامية لهذه الرحلة");
    }
    const { fromUserId: _from, toUserId: _to, ...rest } = tip;
    return rest;
  }

  /** ملخّص الإكراميات التي قبضها السائق. */
  async driverSummary(driverUserId: string) {
    const [aggregate, latest] = await Promise.all([
      this.prisma.tripTip.aggregate({
        where: { toUserId: driverUserId, status: "PAID" },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.tripTip.findMany({
        where: { toUserId: driverUserId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          tripId: true,
          amount: true,
          currency: true,
          status: true,
          note: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total: Number(aggregate._sum.amount ?? 0),
      count: aggregate._count._all,
      latest,
    };
  }

  /** إشعار السائق دون إفشال المعاملة المالية إذا تعذّر الإرسال. */
  private notifyDriverQuietly(
    driverUserId: string,
    amount: number,
    currency: string,
  ): void {
    void this.notifications
      .notifyUser(
        driverUserId,
        "إكرامية جديدة",
        `وصلتك إكرامية بقيمة ${amount} ${currency}`,
        "PUSH",
        { type: "TRIP_TIP", amount: String(amount), currency },
      )
      .catch((error) =>
        this.logger.warn(`تعذّر إشعار السائق بالإكرامية: ${String(error)}`),
      );
  }
}
