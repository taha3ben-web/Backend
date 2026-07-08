import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateRatingDto } from "./dto/support.dto";

@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * تقييم طرف الرحلة الآخر بعد اكتمالها.
   * يحدد المُقَيّم تلقائيًا الطرف الآخر، ويمنع التكرار،
   * ويعيد حساب متوسط تقييم السائق إن كان هو المُقَيّم عليه.
   */
  async rateTrip(authorId: string, dto: CreateRatingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { driver: { select: { userId: true } } },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.status !== "COMPLETED") {
      throw new BadRequestException("لا يمكن التقييم قبل اكتمال الرحلة");
    }

    const driverUserId = trip.driver?.userId ?? null;
    const isPassenger = trip.passengerId === authorId;
    const isDriver = driverUserId != null && driverUserId === authorId;
    if (!isPassenger && !isDriver) {
      throw new BadRequestException("لست طرفًا في هذه الرحلة");
    }

    // الطرف المُقَيّم عليه هو الآخر
    const targetId = isPassenger ? driverUserId : trip.passengerId;
    if (!targetId) {
      throw new BadRequestException("لا يوجد طرف آخر لتقييمه");
    }

    const existing = await this.prisma.rating.findFirst({
      where: { tripId: dto.tripId, authorId },
    });
    if (existing) throw new BadRequestException("قمت بتقييم هذه الرحلة مسبقًا");

    const rating = await this.prisma.rating.create({
      data: {
        tripId: dto.tripId,
        authorId,
        targetId,
        stars: dto.stars,
        comment: dto.comment,
      },
    });

    // إذا كان المُقَيّم عليه سائقًا ← أعد حساب متوسط تقييمه
    if (isPassenger && driverUserId) {
      await this.recomputeDriverRating(driverUserId);
    }
    return rating;
  }

  /** متوسط تقييم سائق من جميع التقييمات المستلمة */
  private async recomputeDriverRating(driverUserId: string): Promise<void> {
    const agg = await this.prisma.rating.aggregate({
      where: { targetId: driverUserId },
      _avg: { stars: true },
    });
    const avg = agg._avg.stars ?? 5;
    await this.prisma.driver.update({
      where: { userId: driverUserId },
      data: { rating: Math.round(avg * 100) / 100 },
    });
  }

  /** قائمة إدارية بكل التقييمات (مع فلترة اختيارية بعدد النجوم) */
  async adminList(q: PaginationDto, stars?: number) {
    const where = stars ? { stars } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rating.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          author: { select: { name: true } },
          target: { select: { name: true } },
          trip: { select: { id: true } },
        },
      }),
      this.prisma.rating.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** تقييمات مستخدم (المستلمة) */
  async forUser(userId: string, q: PaginationDto) {
    const where = { targetId: userId };
    const [items, total, agg] = await this.prisma.$transaction([
      this.prisma.rating.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      }),
      this.prisma.rating.count({ where }),
      this.prisma.rating.aggregate({ where, _avg: { stars: true } }),
    ]);
    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      average: Math.round((agg._avg.stars ?? 0) * 100) / 100,
    };
  }
}
