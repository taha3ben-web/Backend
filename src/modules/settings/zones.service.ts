import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateZoneDto, UpdateZoneDto } from "./dto/settings.dto";

/** خدمة المناطق (Zones) داخل المدن — polygon لمناطق الطلب/التسعير. */
@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCity(cityId: string) {
    return this.prisma.zone.findMany({
      where: { cityId },
      orderBy: { name: "asc" },
    });
  }

  async findOne(id: string) {
    const zone = await this.prisma.zone.findUnique({
      where: { id },
      include: { city: { select: { id: true, name: true } } },
    });
    if (!zone) throw new NotFoundException("المنطقة غير موجودة");
    return zone;
  }

  async create(dto: CreateZoneDto) {
    const city = await this.prisma.city.findUnique({
      where: { id: dto.cityId },
    });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
    return this.prisma.zone.create({
      data: {
        cityId: dto.cityId,
        name: dto.name,
        polygon: (dto.polygon ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, dto: UpdateZoneDto) {
    await this.findOne(id);
    return this.prisma.zone.update({
      where: { id },
      data: {
        name: dto.name,
        polygon: (dto.polygon ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.zone.delete({ where: { id } });
    return { success: true };
  }
}
