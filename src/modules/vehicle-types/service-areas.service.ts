import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "./audit.service";
import { EventBusService } from "../../common/infra/event-bus.service";
import { CatalogCacheService } from "../../common/infra/catalog-cache.service";
import {
  paginated,
  skipTake,
  orderByOf,
  isTrue,
  Paginated,
} from "../../common/query.util";
import { ListQueryDto } from "../../common/dto/list-query.dto";
import {
  CreateServiceAreaDto,
  UpdateServiceAreaDto,
} from "./dto/service-area.dto";

const SORTABLE = ["name", "sortOrder", "createdAt", "updatedAt", "version"];

/**
 * خدمة مناطق الخدمة: CRUD + تفعيل + حذف ناعم + إصدار + أحداث + Cache + تدقيق.
 * مصمّمة بشكل عام (provider) تدعم GEOJSON / Google دون تغيير قاعدة البيانات.
 */
@Injectable()
export class ServiceAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private geo(v?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
  }

  async findAll(q: ListQueryDto = {} as ListQueryDto): Promise<Paginated<unknown>> {
    const where: Prisma.ServiceAreaWhereInput = {
      ...(isTrue(q.includeDeleted) ? {} : { deletedAt: null }),
      ...(isTrue(q.activeOnly) ? { isActive: true } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { city: { contains: q.search, mode: "insensitive" } },
              { country: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const { skip, take } = skipTake(q.page, q.limit);
    const orderBy = orderByOf(q.sortBy, q.sortOrder ?? "asc", SORTABLE, [
      { sortOrder: "asc" },
      { name: "asc" },
    ]);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.serviceArea.findMany({ where, orderBy, skip, take }),
      this.prisma.serviceArea.count({ where }),
    ]);
    return paginated(data, total, q.page ?? 1, q.limit ?? 20);
  }

  async findOne(id: string) {
    const area = await this.prisma.serviceArea.findUnique({ where: { id } });
    if (!area) throw new NotFoundException("منطقة الخدمة غير موجودة");
    return area;
  }

  async create(dto: CreateServiceAreaDto, actorId?: string) {
    const created = await this.prisma.serviceArea.create({
      data: {
        name: dto.name,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        geojson: this.geo(dto.geojson),
        provider: dto.provider ?? "GEOJSON",
        providerRef: this.geo(dto.providerRef),
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.afterWrite("CREATE", created.id, dto, actorId, "created");
    return created;
  }

  async update(id: string, dto: UpdateServiceAreaDto, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.serviceArea.update({
      where: { id },
      data: {
        name: dto.name,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        geojson: this.geo(dto.geojson),
        provider: dto.provider,
        providerRef: this.geo(dto.providerRef),
        centerLat: dto.centerLat,
        centerLng: dto.centerLng,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        version: { increment: 1 },
      },
    });
    await this.afterWrite("UPDATE", id, dto, actorId, "updated");
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.ensureExists(id);
    await this.prisma.serviceArea.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, version: { increment: 1 } },
    });
    await this.afterWrite("DELETE", id, null, actorId, "deleted");
    return { success: true };
  }

  async restore(id: string, actorId?: string) {
    const updated = await this.prisma.serviceArea.update({
      where: { id },
      data: { deletedAt: null, isActive: true, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { restore: true }, actorId, "restored");
    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.serviceArea.update({
      where: { id },
      data: { isActive, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { isActive }, actorId, "updated");
    return updated;
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.serviceArea.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("منطقة الخدمة غير موجودة");
  }

  private async afterWrite(
    action: string,
    entityId: string | null,
    changes: unknown,
    actorId: string | undefined,
    verb: string,
  ) {
    await this.audit.log({
      actorId,
      action,
      entity: "ServiceArea",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit(`catalog.serviceArea.${verb}`, {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
