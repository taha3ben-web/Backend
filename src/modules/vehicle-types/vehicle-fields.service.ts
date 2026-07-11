import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "./audit.service";
import { EventBusService } from "../../common/infra/event-bus.service";
import { CatalogCacheService } from "../../common/infra/catalog-cache.service";
import {
  CreateVehicleFieldDto,
  UpdateVehicleFieldDto,
} from "./dto/vehicle-field.dto";

/**
 * خدمة الحقول الديناميكية (Dynamic Forms): ينشئ المدير حقولًا مخصصة
 * لكل نوع مركبة من اللوحة دون تعديل الكود. يقرأها التطبيق من الكتالوج.
 */
@Injectable()
export class VehicleFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private json(v?: unknown): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
  }

  findAll(vehicleTypeId: string) {
    return this.prisma.vehicleTypeField.findMany({
      where: { vehicleTypeId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async findOne(id: string) {
    const f = await this.prisma.vehicleTypeField.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("الحقل غير موجود");
    return f;
  }

  async create(dto: CreateVehicleFieldDto, actorId?: string) {
    const type = await this.prisma.vehicleType.findUnique({
      where: { id: dto.vehicleTypeId },
      select: { id: true },
    });
    if (!type) throw new NotFoundException("نوع المركبة غير موجود");
    const dup = await this.prisma.vehicleTypeField.findUnique({
      where: {
        vehicleTypeId_key: { vehicleTypeId: dto.vehicleTypeId, key: dto.key },
      },
    });
    if (dup) throw new ConflictException("مفتاح الحقل (key) مستخدم لهذا النوع");
    const created = await this.prisma.vehicleTypeField.create({
      data: {
        vehicleTypeId: dto.vehicleTypeId,
        key: dto.key,
        label: dto.label,
        labelI18n: this.json(dto.labelI18n),
        fieldType: dto.fieldType ?? "TEXT",
        options: this.json(dto.options),
        required: dto.required ?? false,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.afterWrite("CREATE", created.id, dto, actorId);
    return created;
  }

  async update(id: string, dto: UpdateVehicleFieldDto, actorId?: string) {
    await this.findOne(id);
    const updated = await this.prisma.vehicleTypeField.update({
      where: { id },
      data: {
        key: dto.key,
        label: dto.label,
        labelI18n: this.json(dto.labelI18n),
        fieldType: dto.fieldType,
        options: this.json(dto.options),
        required: dto.required,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    await this.afterWrite("UPDATE", id, dto, actorId);
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.findOne(id);
    await this.prisma.vehicleTypeField.delete({ where: { id } });
    await this.afterWrite("DELETE", id, null, actorId);
    return { success: true };
  }

  private async afterWrite(
    action: string,
    entityId: string,
    changes: unknown,
    actorId?: string,
  ) {
    await this.audit.log({
      actorId,
      action,
      entity: "VehicleTypeField",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit("catalog.vehicleTypeField.changed", {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
