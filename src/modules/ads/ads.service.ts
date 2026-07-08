import { Injectable, NotFoundException } from "@nestjs/common";
import { AdPlacement } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAdDto, UpdateAdDto } from "./dto/ad.dto";

/** خدمة الإعلانات: CRUD كامل + استعلام الإعلانات النشطة للتطبيقات. */
@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(placement?: AdPlacement) {
    return this.prisma.advertisement.findMany({
      where: placement ? { placement } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  /** الإعلانات النشطة حاليًا لموضع معيّن (للتطبيقات). */
  findActive(placement: AdPlacement) {
    const now = new Date();
    return this.prisma.advertisement.findMany({
      where: {
        isActive: true,
        OR: [{ placement }, { placement: "ALL" }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  async findOne(id: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException("الإعلان غير موجود");
    return ad;
  }

  create(dto: CreateAdDto) {
    return this.prisma.advertisement.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        targetUrl: dto.targetUrl,
        placement: dto.placement ?? "PASSENGER_HOME",
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateAdDto) {
    await this.findOne(id);
    return this.prisma.advertisement.update({
      where: { id },
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        targetUrl: dto.targetUrl,
        placement: dto.placement,
        isActive: dto.isActive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.advertisement.delete({ where: { id } });
    return { success: true };
  }
}
