import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RideClass, VehicleVerificationStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";

/** خدمة إدارة مركبات السائقين (عرض عام + تفعيل/تعطيل). */
@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    q: PaginationDto,
    rideClass?: RideClass,
    status?: VehicleVerificationStatus,
  ) {
    const where: Prisma.VehicleWhereInput = {
      ...(rideClass ? { rideClass } : {}),
      ...(status ? { verificationStatus: status } : {}),
      ...(q.search
        ? {
            OR: [
              { plate: { contains: q.search, mode: "insensitive" } },
              { make: { contains: q.search, mode: "insensitive" } },
              { model: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          driver: {
            select: {
              id: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async toggle(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException("المركبة غير موجودة");
    return this.prisma.vehicle.update({
      where: { id },
      data: { isActive: !vehicle.isActive },
    });
  }

  /** مراجعة تحقق المركبة (اعتماد/رفض) من قِبل الطاقم. */
  async review(
    id: string,
    status: "APPROVED" | "REJECTED",
    reviewedById: string,
    note?: string,
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new AppException("VEHICLE_NOT_FOUND");
    return this.prisma.vehicle.update({
      where: { id },
      data: {
        verificationStatus: status,
        verificationNote: note ?? null,
        verifiedById: reviewedById,
        verifiedAt: new Date(),
      },
    });
  }
}
