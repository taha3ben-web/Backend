import { Injectable, NotFoundException } from "@nestjs/common";
import { DriverStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAll(q: PaginationDto, status?: DriverStatus) {
    const where: Prisma.DriverWhereInput = {
      ...(status ? { status } : {}),
      ...(q.search
        ? {
            user: {
              OR: [
                { name: { contains: q.search, mode: "insensitive" } },
                { phone: { contains: q.search } },
              ],
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true, status: true } },
          vehicles: { where: { isActive: true }, take: 1 },
          city: { select: { name: true } },
        },
      }),
      this.prisma.driver.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            name: true,
            phone: true,
            email: true,
            status: true,
            avatarUrl: true,
            createdAt: true,
            wallet: {
              select: {
                id: true,
                balance: true,
                currency: true,
                updatedAt: true,
                transactions: {
                  take: 20,
                  orderBy: { createdAt: "desc" },
                  select: {
                    id: true,
                    type: true,
                    amount: true,
                    balanceAfter: true,
                    reason: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
        vehicles: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { createdAt: "desc" } },
        city: true,
        trips: {
          take: 10,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            fare: true,
            pickupAddress: true,
            destAddress: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    });
    if (!driver) throw new NotFoundException("Driver not found");

    // ملخّص أرباح السائق (إجمالي الصافي والعمولة وعدد الرحلات المدفوعة)
    const earningsAgg = await this.prisma.driverEarning.aggregate({
      where: { driverId: id },
      _sum: { net: true, gross: true, commission: true },
      _count: true,
    });

    // الموقع اللحظي من Redis (إن وجد)
    const live = await this.redis.client.hgetall(`driver:${id}`);
    return {
      ...driver,
      // نُبرِز المحفظة في المستوى الأعلى لتسهيل قراءتها في اللوحة.
      wallet: driver.user?.wallet ?? null,
      earningsSummary: {
        net: Number(earningsAgg._sum.net ?? 0),
        gross: Number(earningsAgg._sum.gross ?? 0),
        commission: Number(earningsAgg._sum.commission ?? 0),
        count: earningsAgg._count,
      },
      live: live?.lat ? live : null,
    };
  }

  setStatus(id: string, status: DriverStatus, message?: string) {
    return this.prisma.driver.update({
      where: { id },
      data: {
        status,
        // رسالة يتحكّم بها الطاقم من لوحة التحكم وتظهر للسائق في التطبيق.
        ...(message !== undefined ? { statusMessage: message || null } : {}),
      },
    });
  }

  async reviewDocument(
    docId: string,
    status: "APPROVED" | "REJECTED",
    reviewedById: string,
    note?: string,
  ) {
    return this.prisma.driverDocument.update({
      where: { id: docId },
      data: { status, reviewedById, note },
    });
  }
}
