import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** تسجيل عملية في سجل التدقيق (لا ترمي أبدًا حتى لا تكسر الطلب) */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          meta: entry.meta,
        },
      });
    } catch (err) {
      this.logger.warn(`تعذّر تسجيل التدقيق: ${String(err)}`);
    }
  }

  /** تسجيل نشاط مستخدم عام (لا إداري) */
  async recordActivity(
    userId: string | null,
    action: string,
    ip?: string | null,
    meta?: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: { userId, action, ip: ip ?? null, meta },
      });
    } catch (err) {
      this.logger.warn(`تعذّر تسجيل النشاط: ${String(err)}`);
    }
  }

  /** قائمة سجل التدقيق (مع فلترة اختيارية) */
  async findAuditLogs(
    q: PaginationDto,
    filters: { actorId?: string; entity?: string } = {},
  ) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entity) where.entity = filters.entity;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true, type: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** قائمة سجل النشاط */
  async findActivityLogs(q: PaginationDto, userId?: string) {
    const where: Prisma.ActivityLogWhereInput = userId ? { userId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, type: true } } },
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
