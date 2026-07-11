import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WithdrawStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async findAll(q: PaginationDto, status?: WithdrawStatus) {
    const where: Prisma.WithdrawRequestWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          driver: { select: { id: true } },
        },
      }),
      this.prisma.withdrawRequest.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /**
   * ينشئ السائق طلب سحب. نتحقق من كفاية الرصيد ثم نحجز المبلغ
   * (خصم من المحفظة فورًا) حتى لا يُطلب مرتين.
   */
  async createForDriver(userId: string, amount: number, note?: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException("السائق غير موجود");

    const request = await this.prisma.withdrawRequest.create({ data: { driverId: driver.id, userId, amount, note, status: "PENDING" } });
    try { await this.financial.reserveWithdrawal(request.id); } catch (error) { await this.prisma.withdrawRequest.delete({ where: { id: request.id } }); throw error; }
    return request;
  }

  /** المدير يوافق على الطلب (المبلغ محجوز مسبقًا) */
  async approve(id: string, processedById: string, note?: string) {
    const req = await this.getPending(id);
    return this.prisma.withdrawRequest.update({
      where: { id: req.id },
      data: {
        status: "APPROVED",
        processedById,
        note: note ?? req.note,
        processedAt: new Date(),
      },
    });
  }

  /** تأكيد الدفع فعليًا (بعد التحويل البنكي) */
  async markPaid(id: string, processedById: string, note?: string) {
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("الطلب غير موجود");
    if (req.status !== "APPROVED" && req.status !== "PENDING") {
      throw new BadRequestException("لا يمكن تأكيد دفع هذا الطلب");
    }
    await this.financial.completeWithdrawal(id);
    return this.prisma.withdrawRequest.update({
      where: { id },
      data: {
        status: "PAID",
        processedById,
        note: note ?? req.note,
        processedAt: new Date(),
      },
    });
  }

  /** رفض الطلب: نعيد المبلغ المحجوز إلى محفظة السائق */
  async reject(id: string, processedById: string, note?: string) {
    const req = await this.getPending(id);
    await this.financial.releaseWithdrawal(id);
    return this.prisma.withdrawRequest.update({ where: { id: req.id }, data: { status: "REJECTED", processedById, note: note ?? req.note, processedAt: new Date() } });
  }

  private async getPending(id: string) {
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("الطلب غير موجود");
    if (req.status !== "PENDING") {
      throw new BadRequestException("تمت معالجة هذا الطلب مسبقًا");
    }
    return req;
  }
}
