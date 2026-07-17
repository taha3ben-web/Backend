import { DEFAULT_CURRENCY } from "../../common/money.util";
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
  CreateVehiclePricingRuleDto,
  UpdateVehiclePricingRuleDto,
} from "./dto/vehicle-pricing.dto";

const SORTABLE = ["priority", "createdAt", "updatedAt", "version", "name"];

/**
 * خدمة قواعد التسعير المرنة. يُسمح بأكثر من قاعدة لنفس النوع.
 * حذف ناعم + إصدار + بحث/ترقيم + أحداث + Cache.
 */
@Injectable()
export class VehiclePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private parseDate(v?: string): Date | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }

  private json(v?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
  }

  private normalizeArray(
    values: string[] | undefined,
    casing: "upper" | "lower",
  ) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values ?? []) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const next =
        casing === "upper" ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (seen.has(next)) continue;
      seen.add(next);
      result.push(next);
    }
    return result;
  }

  async findAll(
    q: ListQueryDto & { vehicleTypeId?: string } = {} as ListQueryDto,
  ): Promise<Paginated<unknown>> {
    const where: Prisma.VehiclePricingRuleWhereInput = {
      ...(isTrue(q.includeDeleted) ? {} : { deletedAt: null }),
      ...(isTrue(q.activeOnly) ? { isActive: true } : {}),
      ...(q.vehicleTypeId ? { vehicleTypeId: q.vehicleTypeId } : {}),
      ...(q.search
        ? { name: { contains: q.search, mode: "insensitive" } }
        : {}),
    };
    const { skip, take } = skipTake(q.page, q.limit);
    const orderBy = orderByOf(q.sortBy, q.sortOrder ?? "desc", SORTABLE, [
      { priority: "desc" },
      { createdAt: "asc" },
    ]);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.vehiclePricingRule.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { serviceArea: true },
      }),
      this.prisma.vehiclePricingRule.count({ where }),
    ]);
    return paginated(data, total, q.page ?? 1, q.limit ?? 20);
  }

  async findOne(id: string) {
    const p = await this.prisma.vehiclePricingRule.findUnique({
      where: { id },
      include: { serviceArea: true },
    });
    if (!p) throw new NotFoundException("قاعدة التسعير غير موجودة");
    return p;
  }

  async create(dto: CreateVehiclePricingRuleDto, actorId?: string) {
    const type = await this.prisma.vehicleType.findUnique({
      where: { id: dto.vehicleTypeId },
      select: { id: true },
    });
    if (!type) throw new NotFoundException("نوع المركبة غير موجود");
    const created = await this.prisma.vehiclePricingRule.create({
      data: {
        vehicleTypeId: dto.vehicleTypeId,
        name: dto.name,
        serviceAreaId: dto.serviceAreaId,
        cityId: dto.cityId,
        state: dto.state,
        country: dto.country,
        customerType: dto.customerType,
        couponCode: dto.couponCode,
        appIds: this.normalizeArray(dto.appIds, "lower"),
        clientOs: this.normalizeArray(dto.clientOs, "lower"),
        audienceSegments: this.normalizeArray(dto.audienceSegments, "lower"),
        minAppVersion: dto.minAppVersion,
        maxAppVersion: dto.maxAppVersion,
        validFrom: this.parseDate(dto.validFrom),
        validTo: this.parseDate(dto.validTo),
        daysOfWeek: dto.daysOfWeek ?? [],
        startTime: dto.startTime,
        endTime: dto.endTime,
        peakMultiplier: dto.peakMultiplier ?? 1,
        baseFare: dto.baseFare,
        perKm: dto.perKm,
        perMin: dto.perMin,
        minFare: dto.minFare,
        maxFare: dto.maxFare,
        negotiationMin: dto.negotiationMin,
        negotiationMax: dto.negotiationMax,
        commissionPct: dto.commissionPct ?? 0,
        currency: dto.currency ?? DEFAULT_CURRENCY,
        metadata: this.json(dto.metadata),
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.afterWrite("CREATE", created.id, dto, actorId, "created");
    return created;
  }

  async update(id: string, dto: UpdateVehiclePricingRuleDto, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.vehiclePricingRule.update({
      where: { id },
      data: {
        name: dto.name,
        serviceAreaId: dto.serviceAreaId,
        cityId: dto.cityId,
        state: dto.state,
        country: dto.country,
        customerType: dto.customerType,
        couponCode: dto.couponCode,
        appIds:
          dto.appIds === undefined
            ? undefined
            : this.normalizeArray(dto.appIds, "lower"),
        clientOs:
          dto.clientOs === undefined
            ? undefined
            : this.normalizeArray(dto.clientOs, "lower"),
        audienceSegments:
          dto.audienceSegments === undefined
            ? undefined
            : this.normalizeArray(dto.audienceSegments, "lower"),
        minAppVersion: dto.minAppVersion,
        maxAppVersion: dto.maxAppVersion,
        validFrom: this.parseDate(dto.validFrom),
        validTo: this.parseDate(dto.validTo),
        daysOfWeek: dto.daysOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        peakMultiplier: dto.peakMultiplier,
        baseFare: dto.baseFare,
        perKm: dto.perKm,
        perMin: dto.perMin,
        minFare: dto.minFare,
        maxFare: dto.maxFare,
        negotiationMin: dto.negotiationMin,
        negotiationMax: dto.negotiationMax,
        commissionPct: dto.commissionPct,
        currency: dto.currency,
        metadata: this.json(dto.metadata),
        priority: dto.priority,
        isActive: dto.isActive,
        version: { increment: 1 },
      },
    });
    await this.afterWrite("UPDATE", id, dto, actorId, "updated");
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.ensureExists(id);
    await this.prisma.vehiclePricingRule.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        version: { increment: 1 },
      },
    });
    await this.afterWrite("DELETE", id, null, actorId, "deleted");
    return { success: true };
  }

  async restore(id: string, actorId?: string) {
    const updated = await this.prisma.vehiclePricingRule.update({
      where: { id },
      data: { deletedAt: null, isActive: true, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { restore: true }, actorId, "restored");
    return updated;
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.vehiclePricingRule.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("قاعدة التسعير غير موجودة");
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
      entity: "VehiclePricingRule",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit(`catalog.pricing.${verb}`, {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
