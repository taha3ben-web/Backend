import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateVehicleTypeDto,
  UpdateVehicleTypeDto,
} from "./dto/vehicle-type.dto";

/** خدمة أنواع المركبات: CRUD كامل. */
@Injectable()
export class VehicleTypesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(activeOnly = false) {
    return this.prisma.vehicleType.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async findOne(id: string) {
    const type = await this.prisma.vehicleType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException("نوع المركبة غير موجود");
    return type;
  }

  create(dto: CreateVehicleTypeDto) {
    return this.prisma.vehicleType.create({
      data: {
        name: dto.name,
        description: dto.description,
        rideClass: dto.rideClass ?? "ECONOMY",
        multiplier: dto.multiplier ?? 1,
        capacity: dto.capacity ?? 4,
        iconUrl: dto.iconUrl,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateVehicleTypeDto) {
    await this.findOne(id);
    return this.prisma.vehicleType.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        rideClass: dto.rideClass,
        multiplier: dto.multiplier,
        capacity: dto.capacity,
        iconUrl: dto.iconUrl,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.vehicleType.delete({ where: { id } });
    return { success: true };
  }
}
