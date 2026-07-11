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
  paginated,
  skipTake,
  orderByOf,
  isTrue,
  Paginated,
} from "../../common/query.util";
import { ListQueryDto } from "../../common/dto/list-query.dto";
import { CreateFeatureDto, UpdateFeatureDto } from "./dto/feature.dto";

const SORTABLE = ["name", "code", "sortOrder", "createdAt", "updatedAt", "version"];

/**
 * خدمة الميزات المرنة: CRUD + تفعيل + حذف ناعم + إصدار + أحداث + Cache + تدقيق.
 */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBusService,
    private readonly cache: CatalogCacheService,
  ) {}

  private toI18n(v?: Record<string, string>): Prisma.InputJsonValue | undefined {
    return v === undefined ? undefined : (v as Prisma.InputJsonValue);
  }

  async findAll(q: ListQueryDto = {} as ListQueryDto): Promise<Paginated<unknown>> {
    const where: Prisma.FeatureWhereInput = {
      ...(isTrue(q.includeDeleted) ? {} : { deletedAt: null }),
      ...(isTrue(q.activeOnly) ? { isActive: true } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { code: { contains: q.search, mode: "insensitive" } },
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
      this.prisma.feature.findMany({ where, orderBy, skip, take }),
      this.prisma.feature.count({ where }),
    ]);
    return paginated(data, total, q.page ?? 1, q.limit ?? 20);
  }

  async findOne(id: string) {
    const f = await this.prisma.feature.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("الميزة غير موجودة");
    return f;
  }

  async create(dto: CreateFeatureDto, actorId?: string) {
    const existing = await this.prisma.feature.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException("رمز الميزة (code) مستخدم مسبقًا");
    const created = await this.prisma.feature.create({
      data: {
        code: dto.code,
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        iconType: dto.iconType ?? "EMOJI",
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.afterWrite("CREATE", created.id, dto, actorId, "created");
    return created;
  }

  async update(id: string, dto: UpdateFeatureDto, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.feature.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        nameI18n: this.toI18n(dto.nameI18n),
        iconType: dto.iconType,
        iconValue: dto.iconValue,
        iconUrl: dto.iconUrl,
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
    await this.prisma.feature.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, version: { increment: 1 } },
    });
    await this.afterWrite("DELETE", id, null, actorId, "deleted");
    return { success: true };
  }

  async restore(id: string, actorId?: string) {
    const updated = await this.prisma.feature.update({
      where: { id },
      data: { deletedAt: null, isActive: true, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { restore: true }, actorId, "restored");
    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId?: string) {
    await this.ensureExists(id);
    const updated = await this.prisma.feature.update({
      where: { id },
      data: { isActive, version: { increment: 1 } },
    });
    await this.afterWrite("UPDATE", id, { isActive }, actorId, "updated");
    return updated;
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.feature.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("الميزة غير موجودة");
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
      entity: "Feature",
      entityId,
      changes,
    });
    this.cache.invalidate();
    this.events.emit(`catalog.feature.${verb}`, {
      id: entityId,
      catalogVersion: this.cache.getVersion(),
    });
  }
}
