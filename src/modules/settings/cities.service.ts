import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigVersionService } from "./config-version.service";
import { CreateCityDto, UpdateCityDto } from "./dto/settings.dto";

@Injectable()
export class CitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
  ) {}

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
    await this.ensureNameAvailable(dto.name, dto.country);
    const created = await this.prisma.city.create({
      data: {
        name: dto.name.trim(),
        country: dto.country?.trim().toUpperCase(),
        isActive: dto.isActive ?? true,
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
      },
    });
    await this.versions.bump();
    return created;
  }

  async update(id: string, dto: UpdateCityDto) {
    const current = await this.findOne(id);
    if (dto.name || dto.country) {
      await this.ensureNameAvailable(
        dto.name ?? current.name,
        dto.country ?? current.country ?? undefined,
        id,
      );
    }
    const updated = await this.prisma.city.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.country !== undefined
          ? { country: dto.country.trim().toUpperCase() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.centerLat !== undefined ? { centerLat: dto.centerLat } : {}),
        ...(dto.centerLng !== undefined ? { centerLng: dto.centerLng } : {}),
      },
    });
    await this.versions.bump();
    return updated;
  }

  async remove(id: string) {
    const city = await this.prisma.city.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            drivers: true,
            trips: true,
            agents: true,
            pricingRules: true,
          },
        },
      },
    });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
    const linked = city._count;
    if (
      linked.drivers > 0 ||
      linked.trips > 0 ||
      linked.agents > 0 ||
      linked.pricingRules > 0
    ) {
      throw new BadRequestException(
        "لا يمكن حذف مدينة مرتبطة بسائقين أو وكلاء أو رحلات أو قواعد تسعير. عطّلها بدل الحذف.",
      );
    }
    await this.prisma.city.delete({ where: { id } });
    await this.versions.bump();
    return { success: true };
  }

  private async ensureNameAvailable(
    name: string,
    country?: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.city.findFirst({
      where: {
        name: { equals: name.trim(), mode: "insensitive" },
        ...(country
          ? { country: { equals: country.trim(), mode: "insensitive" } }
          : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException("المدينة موجودة مسبقًا");
    }
  }
}
