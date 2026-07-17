import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WorkflowStatus } from "@prisma/client";
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
  CreateVehicleTypeDto,
  UpdateVehicleTypeDto,
} from "./dto/vehicle-type.dto";
import { ReorderDto } from "./dto/vehicle-category.dto";

const TYPE_INCLUDE = {
  category: true,
  pricingRules: {
    where: { deletedAt: null },
    orderBy: { priority: "desc" },
  },
  features: { include: { feature: true } },
  fields: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.VehicleTypeInclude;

const SORTABLE = [
  "name",
  "sortOrder",
  "createdAt",
  "updatedAt",
  "version",
  "capacity",
];

// انتقالات workflow المسموحة.
const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  DRAFT: ["PENDING", "PUBLISHED", "ARCHIVED"],
  PENDING: ["PUBLISHED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT", "PUBLISHED"],
};

/**
 * خدمة أنواع المركبات (خدمة كاملة): CRUD + ترتيب + تفعيل + ربط ميزات
 * + دورة نشر (Workflow) + متطلبات القبول + حذف ناعم + إصدار + أحداث + Cache + تدقيق.
 */
@Injectable()
export class VehicleTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private toI18n(
    v?: Record<string, string>,
  ): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
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
    q: ListQueryDto & { categoryId?: string } = {} as ListQueryDto,
  ): Promise<Paginated<unknown>> {
    const where: Prisma.VehicleTypeWhereInput = {
      ...(isTrue(q.includeDeleted) ? {} : { deletedAt: null }),
      ...(isTrue(q.activeOnly) ? { isActive: true } : {}),
      ...(q.status ? { status: q.status as WorkflowStatus } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { description: { contains: q.search, mode: "insensitive" } },
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
      this.prisma.vehicleType.findMany({
        where,
        orderBy,
        skip,
        take,
        include: TYPE_INCLUDE,
      }),
      this.prisma.vehicleType.count({ where }),
    ]);
    return paginated(data, total, q.page ?? 1, q.limit ?? 20);
  }

  async findOne(id: string) {
    const type = await this.prisma.vehicleType.findUnique({
      where: { id },
      include: TYPE_INCLUDE,
    });
    if (!type) throw new NotFoundException("نوع المركبة غير موجود");
    return type;
  }

  private async syncFeatures(vehicleTypeId: string, featureIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.vehicleTypeFeature.deleteMany({ where: { vehicleTypeId } }),
      ...(featureIds.length
        ? [
            this.prisma.vehicleTypeFeature.createMany({
              data: featureIds.map((featureId) => ({
                vehicleTypeId,
                featureId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  async create(dto: CreateVehicleTypeDto, actorId?: string) {
    const created = await this.prisma.vehicleType.create({
      data: {
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        categoryId: dto.categoryId,
        description: dto.description,
        descriptionI18n: this.toI18n(dto.descriptionI18n),
        rideClass: dto.rideClass ?? "ECONOMY",
        multiplier: dto.multiplier ?? 1,
        capacity: dto.capacity ?? 4,
        luggage: dto.luggage ?? 0,
        notes: dto.notes,
        usageType: dto.usageType ?? "BOTH",
        allowsNegotiation: dto.allowsNegotiation ?? false,
        supportsCash: dto.supportsCash ?? true,
        supportsWallet: dto.supportsWallet ?? true,
        requiresApproval: dto.requiresApproval ?? false,
        visibleToPassengers: dto.visibleToPassengers ?? true,
        visibleToDrivers: dto.visibleToDrivers ?? true,
        appIds: this.normalizeArray(dto.appIds, "lower"),
        clientOs: this.normalizeArray(dto.clientOs, "lower"),
        countryCodes: this.normalizeArray(dto.countryCodes, "upper"),
        audienceSegments: this.normalizeArray(dto.audienceSegments, "lower"),
        minAppVersion: dto.minAppVersion,
        maxAppVersion: dto.maxAppVersion,
        badgeText: dto.badgeText,
        etaMinutes: dto.etaMinutes,
        iconType: dto.iconType ?? "PNG",
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
        imageUrl: dto.imageUrl,
        color: dto.color,
        // متطلبات القبول
        minVehicleYear: dto.minVehicleYear,
        minDriverRating: dto.minDriverRating,
        minDriverTrips: dto.minDriverTrips,
        requiredLicenseType: dto.requiredLicenseType,
        requiredDocuments: dto.requiredDocuments ?? [],
        requiredPhotos: dto.requiredPhotos ?? [],
        requirements: this.json(dto.requirements),
        // الإنشاء من لوحة الإدارة يُنشر مباشرة ليظهر في تطبيقي الراكب والسائق.
        status: (dto.status as WorkflowStatus) ?? "PUBLISHED",
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    if (dto.featureIds) await this.syncFeatures(created.id, dto.featureIds);
    await this.afterWrite("CREATE", created.id, dto, actorId, "created");
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateVehicleTypeDto, actorId?: string) {
    await this.ensureExists(id);
    await this.prisma.vehicleType.update({
      where: { id },
      data: {
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        categoryId: dto.categoryId,
        description: dto.description,
        descriptionI18n: this.toI18n(dto.descriptionI18n),
        rideClass: dto.rideClass,
        multiplier: dto.multiplier,
        capacity: dto.capacity,
        luggage: dto.luggage,
        notes: dto.notes,
        usageType: dto.usageType,
        allowsNegotiation: dto.allowsNegotiation,
        supportsCash: dto.supportsCash,
        supportsWallet: dto.supportsWallet,
        requiresApproval: dto.requiresApproval,
        visibleToPassengers: dto.visibleToPassengers,
        visibleToDrivers: dto.visibleToDrivers,
        appIds:
          dto.appIds === undefined
            ? undefined
            : this.normalizeArray(dto.appIds, "lower"),
        clientOs:
          dto.clientOs === undefined
            ? undefined
            : this.normalizeArray(dto.clientOs, "lower"),
        countryCodes:
          dto.countryCodes === undefined
            ? undefined
            : this.normalizeArray(dto.countryCodes, "upper"),
        audienceSegments:
          dto.audienceSegments === undefined
            ? undefined
            : this.normalizeArray(dto.audienceSegments, "lower"),
        minAppVersion: dto.minAppVersion,
        maxAppVersion: dto.maxAppVersion,
        badgeText: dto.badgeText,
        etaMinutes: dto.etaMinutes,
        iconType: dto.iconType,
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
        imageUrl: dto.imageUrl,
        color: dto.color,
        minVehicleYear: dto.minVehicleYear,
        minDriverRating: dto.minDriverRating,
        minDriverTrips: dto.minDriverTrips,
        requiredLicenseType: dto.requiredLicenseType,
        requiredDocuments: dto.requiredDocuments,
        requiredPhotos: dto.requiredPhotos,
        requirements: this.json(dto.requirements),
        status: dto.status as WorkflowStatus | undefined,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        version: { increment: 1 },
      },
    });
    if (dto.featureIds) await this.syncFeatures(id, dto.featureIds);
    await this.afterWrite("UPDATE", id, dto, actorId, "updated");
    return this.findOne(id);
  }

  /** حذف ناعم (لا يكسر الرحلات/التقارير القديمة). */
  async remove(id: string, actorId?: string) {
    await this.ensureExists(id);
    await this.prisma.vehicleType.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        status: "ARCHIVED",
        version: { increment: 1 },
      },
    });
    await this.afterWrite("DELETE", id, null, actorId, "deleted");
    return { success: true };
  }

  async restore(id: string, actorId?: string) {
    const updated = await this.prisma.vehicleType.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
        status: "DRAFT",
        version: { increment: 1 },
      },
    });
    await this.afterWrite("UPDATE", id, { restore: true }, actorId, "restored");
    return updated;
  }

  /** تغيير حالة النشر مع احترام الانتقالات المسموحة. */
  async setStatus(id: string, status: WorkflowStatus, actorId?: string) {
    const current = await this.prisma.vehicleType.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException("نوع المركبة غير موجود");
    if (
      current.status !== status &&
      !TRANSITIONS[current.status]?.includes(status)
    ) {
      throw new BadRequestException(
        `انتقال غير مسموح: ${current.status} ← ${status}`,
      );
    }
    const updated = await this.prisma.vehicleType.update({
      where: { id },
      data: { status, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { status }, actorId, "status_changed");
    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.vehicleType.update({
      where: { id },
      data: { isActive, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { isActive }, actorId, "updated");
    return updated;
  }

  async reorder(dto: ReorderDto, actorId?: string) {
    await this.prisma.$transaction(
      dto.items.map((it) =>
        this.prisma.vehicleType.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder, version: { increment: 1 } },
        }),
      ),
    );
    await this.afterWrite(
      "UPDATE",
      null,
      { reorder: dto.items },
      actorId,
      "reordered",
    );
    return { success: true };
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.vehicleType.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("نوع المركبة غير موجود");
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
      entity: "VehicleType",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit(`catalog.vehicleType.${verb}`, {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
