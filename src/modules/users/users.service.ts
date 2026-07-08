import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UserStatus, UserType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(q: PaginationDto, type?: UserType) {
    const where: Prisma.UserWhereInput = {
      ...(type ? { type } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { phone: { contains: q.search } },
              { email: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          type: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        ratingsReceived: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async trips(id: string, q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { passengerId: id },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.trip.count({ where: { passengerId: id } }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  setStatus(id: string, status: UserStatus) {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }
}
