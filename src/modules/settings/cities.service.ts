import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCityDto, UpdateCityDto } from "./dto/settings.dto";

/** خدمة المدن: CRUD كامل مع عدّ المناطق/السائقين/الرحلات. */
@Injectable()
export class CitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = true) {
    return this.prisma.city.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { zones: true, drivers: true, trips: true } },
      },
    });
  }

  async findOne(id: string) {
    const city = await this.prisma.city.findUnique({
      where: { id },
      include: {
        zones: { orderBy: { name: "asc" } },
        _count: { select: { zones: true, drivers: true, trips: true } },
      },
    });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
    return city;
  }

  async create(dto: CreateCityDto) {
    return this.prisma.city.create({
      data: {
        name: dto.name,
        country: dto.country,
        isActive: dto.isActive ?? true,
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
      },
    });
  }

  async update(id: string, dto: UpdateCityDto) {
    await this.findOne(id);
    return this.prisma.city.update({
      where: { id },
      data: {
        name: dto.name,
        country: dto.country,
        isActive: dto.isActive,
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
      },
    });
  }

  async remove(id: string) {
    const city = await this.prisma.city.findUnique({
      where: { id },
      include: {
        _count: { select: { drivers: true, trips: true, pricingRules: true } },
      },
    });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
    if (city._count.drivers > 0 || city._count.trips > 0) {
      throw new BadRequestException(
        "لا يمكن حذف مدينة مرتبطة بسائقين أو رحلات. عطّلها بدل الحذف.",
      );
    }
    // المناطق تُحذف تلقائيًا (onDelete: Cascade)
    await this.prisma.city.delete({ where: { id } });
    return { success: true };
  }
}
