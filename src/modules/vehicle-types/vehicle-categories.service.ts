import {
  ConflictException,
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
  CreateVehicleCategoryDto,
  UpdateVehicleCategoryDto,
  ReorderDto,
} from "./dto/vehicle-category.dto";

const SORTABLE = [
  "name",
  "sortOrder",
  "status",
  "createdAt",
  "updatedAt",
  "version",
];

// انتقالات حالة النشر المسموح بها (Workflow).
const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  DRAFT: ["PENDING", "PUBLISHED", "ARCHIVED"],
  PENDING: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT", "PUBLISHED"],
};

/**
 * خدمة فئات المركبات:
 * CRUD + بحث/ترقيم/ترتيب/ترشيح + حذف ناعم + إصدار + دورة نشر
 * + أحداث (Event-Driven) + Cache + تدقيق (Audit) + حارس الاستخدام.
 */
@Injectable()
export class VehicleCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private toI18n(v?: Record<string, string>): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
  }

  // عدّاد الأنواع غير المحذوفة تحت كل فئة (لعرض الاستخدام + حارس الحذف).
  private readonly typeCount = {
    _count: { select: { types: { where: { deletedAt: null } } } },
  } satisfies Prisma.VehicleCategoryInclude;

  async findAll(
    q: ListQueryDto = {} as ListQueryDto,
  ): Promise<Paginated<unknown>> {
    const where: Prisma.VehicleCategoryWhereInput = {
      ...(isTrue(q.includeDeleted) ? {} : { deletedAt: null }),
      ...(isTrue(q.activeOnly) ? { isActive: true } : {}),
      ...(q.status ? { status: q.status as WorkflowStatus } : {}),
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
      this.prisma.vehicleCategory.findMany({
        where,
        orderBy,
        skip,
        take,
        include: this.typeCount,
      }),
      this.prisma.vehicleCategory.count({ where }),
    ]);
    return paginated(data, total, q.page ?? 1, q.limit ?? 20);
  }

  async findOne(id: string) {
    const category = await this.prisma.vehicleCategory.findUnique({
      where: { id },
      include: {
        ...this.typeCount,
        types: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });
    if (!category) throw new NotFoundException("الفئة غير موجودة");
    return category;
  }

  async create(dto: CreateVehicleCategoryDto, actorId?: string) {
    const created = await this.prisma.vehicleCategory.create({
      data: {
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        description: dto.description,
        descriptionI18n: this.toI18n(dto.descriptionI18n),
        iconType: dto.iconType ?? "EMOJI",
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
        imageUrl: dto.imageUrl,
        color: dto.color,
        usageType: dto.usageType ?? "BOTH",
        domain: dto.domain ?? "MOBILITY",
        status: (dto.status as WorkflowStatus) ?? "PUBLISHED",
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.afterWrite("CREATE", created.id, dto, actorId, "created");
    return created;
  }

  async update(id: string, dto: UpdateVehicleCategoryDto, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.vehicleCategory.update({
      where: { id },
      data: {
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        description: dto.description,
        descriptionI18n: this.toI18n(dto.descriptionI18n),
        iconType: dto.iconType,
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
        imageUrl: dto.imageUrl,
        color: dto.color,
        usageType: dto.usageType,
        domain: dto.domain,
        status: dto.status as WorkflowStatus | undefined,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        version: { increment: 1 },
      },
    });
    await this.afterWrite("UPDATE", id, dto, actorId, "updated");
    return updated;
  }

  /**
   * حذف ناعم (أرشفة). لا يُسمح بأرشفة فئة تحتوي أنواعًا نشطة (غير محذوفة)
   * حتى لا تصبح تلك الأنواع يتيمة — على المدير نقلها أو أرشفتها أولًا.
   */
  async remove(id: string, actorId?: string) {
    await this.ensureExists(id);
    const activeTypes = await this.prisma.vehicleType.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (activeTypes > 0) {
      throw new ConflictException(
        `لا يمكن أرشفة هذه الفئة لأنها تحتوي ${activeTypes} نوع مركبة نشط. انقل الأنواع إلى فئة أخرى أو أرشفها أولًا.`,
      );
    }
    await this.prisma.vehicleCategory.update({
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
    const updated = await this.prisma.vehicleCategory.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
        status: "PUBLISHED",
        version: { increment: 1 },
      },
    });
    await this.afterWrite("UPDATE", id, { restore: true }, actorId, "restored");
    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.vehicleCategory.update({
      where: { id },
      data: { isActive, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { isActive }, actorId, "updated");
    return updated;
  }

  async setStatus(id: string, status: WorkflowStatus, actorId?: string) {
    const current = await this.prisma.vehicleCategory.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException("الفئة غير موجودة");
    if (current.status !== status) {
      const allowed = TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(status)) {
        throw new ConflictException(
          `انتقال غير مسموح: من ${current.status} إلى ${status}.`,
        );
      }
    }
    const updated = await this.prisma.vehicleCategory.update({
      where: { id },
      data: { status, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { status }, actorId, "status_changed");
    return updated;
  }

  async reorder(dto: ReorderDto, actorId?: string) {
    await this.prisma.$transaction(
      dto.items.map((it) =>
        this.prisma.vehicleCategory.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
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
    const found = await this.prisma.vehicleCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("الفئة غير موجودة");
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
      entity: "VehicleCategory",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit(`catalog.category.${verb}`, {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
