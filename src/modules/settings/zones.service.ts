import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigVersionService } from "./config-version.service";
import { CreateZoneDto, UpdateZoneDto } from "./dto/settings.dto";

@Injectable()
export class ZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
  ) {}

  async findByCity(cityId: string) {
    if (!cityId) throw new BadRequestException("cityId مطلوب");
    return this.prisma.zone.findMany({
      where: { cityId },
      orderBy: { name: "asc" },
      include: { city: { select: { id: true, name: true } } },
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
    await this.ensureCityExists(dto.cityId);
    await this.ensureNameAvailable(dto.cityId, dto.name);
    this.validatePolygon(dto.polygon);
    const created = await this.prisma.zone.create({
      data: {
        cityId: dto.cityId,
        name: dto.name.trim(),
        polygon: (dto.polygon ?? undefined) as Prisma.InputJsonValue,
      },
      include: { city: { select: { id: true, name: true } } },
    });
    await this.versions.bump();
    return created;
  }

  async update(id: string, dto: UpdateZoneDto) {
    const current = await this.findOne(id);
    const cityId = dto.cityId ?? current.city.id;
    if (dto.cityId) await this.ensureCityExists(dto.cityId);
    if (dto.name || dto.cityId) {
      await this.ensureNameAvailable(cityId, dto.name ?? current.name, id);
    }
    this.validatePolygon(dto.polygon);
    const updated = await this.prisma.zone.update({
      where: { id },
      data: {
        ...(dto.cityId !== undefined ? { cityId: dto.cityId } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.polygon !== undefined
          ? { polygon: dto.polygon as Prisma.InputJsonValue }
          : {}),
      },
      include: { city: { select: { id: true, name: true } } },
    });
    await this.versions.bump();
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.zone.delete({ where: { id } });
    await this.versions.bump();
    return { success: true };
  }

  private async ensureCityExists(cityId: string) {
    const city = await this.prisma.city.findUnique({
      where: { id: cityId },
      select: { id: true },
    });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
  }

  private async ensureNameAvailable(
    cityId: string,
    name: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.zone.findFirst({
      where: {
        cityId,
        name: { equals: name.trim(), mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing)
      throw new BadRequestException("المنطقة موجودة مسبقًا في المدينة");
  }

  private validatePolygon(polygon?: Record<string, unknown>) {
    if (polygon === undefined) return;
    if (polygon.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
      throw new BadRequestException(
        "polygon يجب أن يكون GeoJSON Polygon صالحًا ويحتوي coordinates",
      );
    }
  }
}
