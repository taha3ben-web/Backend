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

  async findAll(q: PaginationDto, status?: WithdrawStatus, search?: string) {
    const where = this.buildWhere(status, search);
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

  async summary(status?: WithdrawStatus, search?: string) {
    const where = this.buildWhere(status, search);
    const [totalCount, totalAmount, pendingCount, approvedCount, paidCount, rejectedCount] =
      await this.prisma.$transaction([
        this.prisma.withdrawRequest.count({ where }),
        this.prisma.withdrawRequest.aggregate({ where, _sum: { amount: true } }),
        this.prisma.withdrawRequest.count({ where: { ...where, status: "PENDING" } }),
        this.prisma.withdrawRequest.count({ where: { ...where, status: "APPROVED" } }),
        this.prisma.withdrawRequest.count({ where: { ...where, status: "PAID" } }),
        this.prisma.withdrawRequest.count({ where: { ...where, status: "REJECTED" } }),
      ]);

    return {
      totalCount,
      totalAmount: Number(totalAmount._sum.amount ?? 0),
      pendingCount,
      approvedCount,
      paidCount,
      rejectedCount,
    };
  }

  async createForDriver(userId: string, amount: number, note?: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException("السائق غير موجود");

    const request = await this.prisma.withdrawRequest.create({
      data: { driverId: driver.id, userId, amount, note, status: "PENDING" },
    });
    try {
      await this.financial.reserveWithdrawal(request.id);
    } catch (error) {
      await this.prisma.withdrawRequest.delete({ where: { id: request.id } });
      throw error;
    }
    return request;
  }

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

  async reject(id: string, processedById: string, note?: string) {
    const req = await this.getPending(id);
    await this.financial.releaseWithdrawal(id);
    return this.prisma.withdrawRequest.update({
      where: { id: req.id },
      data: {
        status: "REJECTED",
        processedById,
        note: note ?? req.note,
        processedAt: new Date(),
      },
    });
  }

  private async getPending(id: string) {
    const req = await this.prisma.withdrawRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException("الطلب غير موجود");
    if (req.status !== "PENDING") {
      throw new BadRequestException("تمت معالجة هذا الطلب مسبقًا");
    }
    return req;
  }

  private buildWhere(status?: WithdrawStatus, search?: string): Prisma.WithdrawRequestWhereInput {
    return {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { phone: { contains: search, mode: "insensitive" } } },
              { note: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }
}
