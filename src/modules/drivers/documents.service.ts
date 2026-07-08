import { Injectable } from "@nestjs/common";
import { DocumentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

/** خدمة إدارة وثائق السائقين (قائمة عامة + مراجعة). */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(q: PaginationDto, status?: DocumentStatus) {
    const where: Prisma.DriverDocumentWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driverDocument.findMany({
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
      this.prisma.driverDocument.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  review(
    id: string,
    status: "APPROVED" | "REJECTED",
    reviewedById: string,
    note?: string,
  ) {
    return this.prisma.driverDocument.update({
      where: { id },
      data: { status, reviewedById, note },
    });
  }
}
