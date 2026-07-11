import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface AuditParams {
  actorId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | string;
  entity: string;
  entityId?: string | null;
  changes?: unknown; // ما الذي تغيّر (يُخزّن في meta)
}

/**
 * خدمة التدقيق: تسجّل من قام بالتعديل ومتى وما الذي تغيّر،
 * في جدول AuditLog الموجود. لا توقف العملية الأصلية إن فشل التسجيل.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId ?? null,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId ?? null,
          meta: (params.changes ?? undefined) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`تعذّر تسجيل التدقيق: ${String(err)}`);
    }
  }

  /**
   * قراءة سجل التدقيق (للوحة): مرشّح حسب الكيان/العنصر مع ترقيم،
   * ويُرفق اسم المُنفّذ (من قام بالتعديل). مرتّب من الأحدث.
   */
  async query(params: {
    entity?: string;
    entityId?: string;
    action?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
    pages: number;
  }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const where = {
      ...(params.entity ? { entity: params.entity } : {}),
      ...(params.entityId ? { entityId: params.entityId } : {}),
      ...(params.action ? { action: params.action } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
