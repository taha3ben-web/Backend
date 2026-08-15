import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DriverStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ProfileLevelsService } from "../profile-levels/profile-levels.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    // المرحلة 11: نفس نقطة حساب المستوى المستخدمة في تطبيق السائق.
    @Inject(forwardRef(() => ProfileLevelsService))
    private readonly profileLevels: ProfileLevelsService,
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
          select: { name: true, phone: true, email: true, status: true },
        },
        vehicles: true,
        documents: true,
        city: true,
      },
    });
    if (!driver) throw new NotFoundException("Driver not found");

    // الموقع اللحظي من Redis (إن وجد). المفتاح مبني على userId (كما يُكتب في
    // realtime.gateway.ts عبر redis.setDriverLocation)، وليس driver.id -
    // كانا مفتاحين مختلفين هنا فيرجع live فارغًا دائمًا حتى مع GPS فعّال.
    const live = await this.redis.client.hgetall(`driver:${driver.userId}`);
    // وثائق السائق مخزّنة كمفاتيح؛ تُحوّل لروابط عند كل طلب مراجعة.
    const documents = await Promise.all(
      (driver.documents ?? []).map(async (doc) => ({
        ...doc,
        url: await this.storage.resolveStoredUrl(
          doc.url,
          STORED_MEDIA_READ_TTL_MINUTES,
        ),
      })),
    );
    // المرحلة 11: مستوى السائق وعدد رحلاته المكتملة للعرض فقط في لوحة
    // الإدارة؛ لا يوجد endpoint لتعديلهما من الخارج.
    const level = await this.profileLevels.forDriver(driver.id);
    return {
      ...driver,
      documents,
      live: live?.lat ? live : null,
      completedTripsCount: level.completedTripsCount,
      profileLevel: level.profileLevel,
      profileFrameUrl: level.profileFrameUrl,
    };
  }

  setStatus(id: string, status: DriverStatus) {
    return this.prisma.driver.update({ where: { id }, data: { status } });
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
