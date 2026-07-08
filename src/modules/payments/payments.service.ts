import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { WalletService } from "./wallet.service";

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async findAll(q: PaginationDto, status?: PaymentStatus) {
    const where: Prisma.PaymentWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          trip: { select: { id: true, fare: true, status: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, phone: true } },
        trip: true,
      },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    return payment;
  }

  /**
   * تسجيل دفعة لرحلة (عادة عند الإنهاء). يأخذ المبلغ من تكلفة الرحلة.
   * إن كانت طريقة الدفع WALLET يُخصم من محفظة الراكب ذريًا.
   */
  async recordForTrip(
    tripId: string,
    method: PaymentMethod,
    reference?: string,
  ) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.fare == null) {
      throw new BadRequestException("الرحلة بدون تكلفة محسوبة");
    }
    const existing = await this.prisma.payment.findUnique({
      where: { tripId },
    });
    if (existing) {
      throw new BadRequestException("يوجد دفعة مسجلة لهذه الرحلة");
    }

    const amount = Number(trip.fare);
    const paidNow = method === "WALLET";

    return this.prisma.$transaction(async (client) => {
      if (paidNow) {
        await this.wallet.adjust(
          trip.passengerId,
          "DEBIT",
          amount,
          `دفع رحلة ${tripId}`,
          client,
        );
      }
      return client.payment.create({
        data: {
          tripId,
          userId: trip.passengerId,
          amount,
          method,
          status: paidNow ? "PAID" : "PENDING",
          reference,
        },
      });
    });
  }

  /** تحديث حالة الدفعة (دفع/فشل/استرداد) من اللوحة */
  async updateStatus(id: string, status: PaymentStatus, reference?: string) {
    const payment = await this.findOne(id);

    // استرداد: إرجاع المبلغ لمحفظة الراكب إن كانت مدفوعة سابقًا
    if (status === "REFUNDED" && payment.status === "PAID") {
      return this.prisma.$transaction(async (client) => {
        // انتقال حالة ذري أولًا: لا نردّ إلا إن كانت الدفعة ما زالت PAID.
        // يمنع الاسترداد المزدوج عند طلبين متزامنين (نقرة مزدوجة/إعادة محاولة).
        const claim = await client.payment.updateMany({
          where: { id, status: "PAID" },
          data: { status, reference: reference ?? payment.reference },
        });
        if (claim.count === 0) {
          throw new BadRequestException("تعذّر الاسترداد — تغيّرت حالة الدفعة");
        }
        await this.wallet.adjust(
          payment.userId,
          "CREDIT",
          Number(payment.amount),
          `استرداد دفعة ${payment.id}`,
          client,
        );
        return client.payment.findUnique({ where: { id } });
      });
    }

    return this.prisma.payment.update({
      where: { id },
      data: { status, reference: reference ?? payment.reference },
    });
  }
}
