import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  SettingChangeRequestStatus,
  SettingPublicationStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigVersionService } from "./config-version.service";
import {
  BulkUpsertSettingsDto,
  UpdateSettingValueDto,
  UpsertSettingDto,
} from "./dto/settings.dto";

interface PublicConfigCache {
  expiresAt: number;
  value: unknown;
}

@Injectable()
export class SettingsService {
  private publicCache: PublicConfigCache | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
  ) {}

  async findAll(group?: string) {
    const rows = await this.prisma.setting.findMany({
      where: {
        ...(group ? { group } : {}),
        key: { not: "system.configVersion" },
      },
      orderBy: [{ group: "asc" }, { key: "asc" }],
      include: {
        changeRequests: {
          where: { status: SettingChangeRequestStatus.PENDING },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            requestedById: true,
            sourceVersion: true,
            createdAt: true,
          },
        },
      },
    });
    return rows.map((row) => this.toAdminSetting(row));
  }

  async findOne(key: string) {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
      include: {
        changeRequests: {
          where: { status: SettingChangeRequestStatus.PENDING },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            requestedById: true,
            sourceVersion: true,
            createdAt: true,
          },
        },
      },
    });
    if (!setting || key === "system.configVersion") {
      throw new NotFoundException("الإعداد غير موجود");
    }
    return this.toAdminSetting(setting);
  }

  async getValue<T = unknown>(key: string, fallback?: T): Promise<T> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) return fallback as T;
    const value =
      setting.isPublic && setting.publishedValue !== null
        ? setting.publishedValue
        : setting.value;
    return value as T;
  }

  async publicConfig() {
    if (this.publicCache && this.publicCache.expiresAt > Date.now()) {
      return this.publicCache.value;
    }

    const [settings, cities, version] = await Promise.all([
      this.prisma.setting.findMany({
        where: {
          isPublic: true,
          isSensitive: false,
          publicationStatus: SettingPublicationStatus.PUBLISHED,
          key: { not: "system.configVersion" },
        },
        orderBy: { key: "asc" },
        select: {
          key: true,
          publishedValue: true,
          publishedVersion: true,
          publishedAt: true,
        },
      }),
      this.prisma.city.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          country: true,
          centerLat: true,
          centerLng: true,
          updatedAt: true,
          zones: {
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              polygon: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.versions.current(),
    ]);

    const values: Record<string, Prisma.JsonValue> = {};
    const settingVersions: Record<string, number> = {};
    for (const setting of settings) {
      if (setting.publishedValue === null) continue;
      values[setting.key] = setting.publishedValue;
      settingVersions[setting.key] = setting.publishedVersion;
    }

    const value = {
      version,
      generatedAt: new Date().toISOString(),
      settings: values,
      settingVersions,
      cities,
    };
    this.publicCache = { value, expiresAt: Date.now() + 15_000 };
    return value;
  }

  async upsert(dto: UpsertSettingDto) {
    this.assertVisibility(dto.isPublic, dto.isSensitive);
    const existing = await this.prisma.setting.findUnique({
      where: { key: dto.key },
    });
    const sensitivity = dto.isSensitive ?? existing?.isSensitive ?? false;
    const isPublic = dto.isPublic ?? existing?.isPublic ?? false;
    this.assertVisibility(isPublic, sensitivity);
    this.assertPublishedVisibilityUnchanged(existing, isPublic, sensitivity);
    const publicConfigChanged =
      this.isPublishedPublic(existing) && (!isPublic || sensitivity);

    const saved = await this.prisma.setting.upsert({
      where: { key: dto.key },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        ...(dto.group !== undefined ? { group: dto.group || null } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        ...(dto.isSensitive !== undefined
          ? { isSensitive: dto.isSensitive }
          : {}),
        publicationStatus: isPublic
          ? SettingPublicationStatus.DRAFT
          : SettingPublicationStatus.PUBLISHED,
        version: { increment: 1 },
      },
      create: {
        key: dto.key,
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
        isPublic,
        isSensitive: sensitivity,
        publicationStatus: isPublic
          ? SettingPublicationStatus.DRAFT
          : SettingPublicationStatus.PUBLISHED,
      },
    });
    await this.afterMutation(publicConfigChanged);
    return this.toAdminSetting(saved);
  }

  async updateValue(key: string, dto: UpdateSettingValueDto) {
    if (key === "system.configVersion") {
      throw new BadRequestException("هذا إعداد داخلي لا يمكن تعديله");
    }
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    const sensitivity = dto.isSensitive ?? existing?.isSensitive ?? false;
    const isPublic = dto.isPublic ?? existing?.isPublic ?? false;
    this.assertVisibility(isPublic, sensitivity);
    this.assertPublishedVisibilityUnchanged(existing, isPublic, sensitivity);
    const publicConfigChanged =
      this.isPublishedPublic(existing) && (!isPublic || sensitivity);

    const shouldPreserveSecret =
      sensitivity &&
      existing &&
      (dto.value === undefined || dto.value === null || dto.value === "");
    if (!existing && dto.value === undefined) {
      throw new BadRequestException("قيمة الإعداد مطلوبة عند الإنشاء");
    }

    const saved = existing
      ? await this.prisma.setting.update({
          where: { key },
          data: {
            ...(!shouldPreserveSecret && dto.value !== undefined
              ? { value: dto.value as Prisma.InputJsonValue }
              : {}),
            ...(dto.group !== undefined ? { group: dto.group || null } : {}),
            ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
            ...(dto.isSensitive !== undefined
              ? { isSensitive: dto.isSensitive }
              : {}),
            publicationStatus: isPublic
              ? SettingPublicationStatus.DRAFT
              : SettingPublicationStatus.PUBLISHED,
            version: { increment: 1 },
          },
        })
      : await this.prisma.setting.create({
          data: {
            key,
            value: dto.value as Prisma.InputJsonValue,
            group: dto.group,
            isPublic,
            isSensitive: sensitivity,
            publicationStatus: isPublic
              ? SettingPublicationStatus.DRAFT
              : SettingPublicationStatus.PUBLISHED,
          },
        });
    await this.afterMutation(publicConfigChanged);
    return this.toAdminSetting(saved);
  }

  async bulkUpsert(dto: BulkUpsertSettingsDto) {
    for (const item of dto.items) {
      this.assertVisibility(item.isPublic, item.isSensitive);
    }

    const existing = await this.prisma.setting.findMany({
      where: { key: { in: dto.items.map((item) => item.key) } },
    });
    const byKey = new Map(existing.map((item) => [item.key, item]));
    const publicConfigChanged = dto.items.some((item) => {
      const current = byKey.get(item.key);
      const isPublic = item.isPublic ?? current?.isPublic ?? false;
      const isSensitive = item.isSensitive ?? current?.isSensitive ?? false;
      return this.isPublishedPublic(current) && (!isPublic || isSensitive);
    });

    const saved = await this.prisma.$transaction(
      dto.items.map((item) => {
        const current = byKey.get(item.key);
        const sensitivity = item.isSensitive ?? current?.isSensitive ?? false;
        const isPublic = item.isPublic ?? current?.isPublic ?? false;
        this.assertVisibility(isPublic, sensitivity);
        this.assertPublishedVisibilityUnchanged(current, isPublic, sensitivity);
        return this.prisma.setting.upsert({
          where: { key: item.key },
          update: {
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
            isPublic,
            isSensitive: sensitivity,
            publicationStatus: isPublic
              ? SettingPublicationStatus.DRAFT
              : SettingPublicationStatus.PUBLISHED,
            version: { increment: 1 },
          },
          create: {
            key: item.key,
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
            isPublic,
            isSensitive: sensitivity,
            publicationStatus: isPublic
              ? SettingPublicationStatus.DRAFT
              : SettingPublicationStatus.PUBLISHED,
          },
        });
      }),
    );
    await this.afterMutation(publicConfigChanged);
    return saved.map((row) => this.toAdminSetting(row));
  }

  async requestReview(key: string, actorId: string) {
    if (key === "system.configVersion") {
      throw new BadRequestException("هذا إعداد داخلي لا يمكن إرساله للمراجعة");
    }
    return this.prisma.$transaction(
      async (tx) => {
        const setting = await tx.setting.findUnique({ where: { key } });
        if (!setting) throw new NotFoundException("الإعداد غير موجود");
        if (!setting.isPublic || setting.isSensitive) {
          throw new BadRequestException(
            "يمكن مراجعة الإعدادات العامة غير الحساسة فقط",
          );
        }
        if (setting.publicationStatus !== SettingPublicationStatus.DRAFT) {
          throw new BadRequestException("لا توجد مسودة جاهزة للمراجعة");
        }
        const pending = await tx.settingChangeRequest.findFirst({
          where: {
            settingId: setting.id,
            status: SettingChangeRequestStatus.PENDING,
          },
          select: { id: true },
        });
        if (pending) {
          throw new BadRequestException("يوجد طلب مراجعة مفتوح لهذا الإعداد");
        }
        return tx.settingChangeRequest.create({
          data: {
            settingId: setting.id,
            requestedValue: setting.value as Prisma.InputJsonValue,
            sourceVersion: setting.version,
            requestedById: actorId,
          },
          include: {
            setting: { select: { key: true } },
            requestedBy: { select: { id: true, name: true, email: true } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * نظرة حوكمة موحّدة للإعدادات (قراءة فقط) — تجمع العدّادات
   * والمسودّات بانتظار النشر وطلبات التغيير المعلّقة وسجلّ
   * التغييرات الأخيرة عبر جميع المفاتيح في استدعاء واحد.
   */
  async governanceOverview(limit = 20) {
    const cap = Math.min(100, Math.max(1, limit));
    const notInternal = { key: { not: "system.configVersion" } };
    const [
      total,
      published,
      drafts,
      publicCount,
      sensitiveCount,
      pendingChangeRequests,
      draftRows,
      revisions,
      pendingReqs,
    ] = await this.prisma.$transaction([
      this.prisma.setting.count({ where: notInternal }),
      this.prisma.setting.count({
        where: {
          ...notInternal,
          publicationStatus: SettingPublicationStatus.PUBLISHED,
        },
      }),
      this.prisma.setting.count({
        where: {
          ...notInternal,
          publicationStatus: SettingPublicationStatus.DRAFT,
        },
      }),
      this.prisma.setting.count({ where: { ...notInternal, isPublic: true } }),
      this.prisma.setting.count({
        where: { ...notInternal, isSensitive: true },
      }),
      this.prisma.settingChangeRequest.count({
        where: { status: SettingChangeRequestStatus.PENDING },
      }),
      this.prisma.setting.findMany({
        where: {
          ...notInternal,
          publicationStatus: SettingPublicationStatus.DRAFT,
        },
        orderBy: { updatedAt: "desc" },
        take: cap,
        select: {
          id: true,
          key: true,
          group: true,
          isPublic: true,
          isSensitive: true,
          version: true,
          publishedVersion: true,
          publishedAt: true,
          updatedAt: true,
          changeRequests: {
            where: { status: SettingChangeRequestStatus.PENDING },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.settingRevision.findMany({
        orderBy: { createdAt: "desc" },
        take: cap,
        select: {
          id: true,
          publishedVersion: true,
          sourceVersion: true,
          action: true,
          publishedById: true,
          createdAt: true,
          setting: { select: { key: true, group: true } },
        },
      }),
      this.prisma.settingChangeRequest.findMany({
        where: { status: SettingChangeRequestStatus.PENDING },
        orderBy: { createdAt: "desc" },
        take: cap,
        select: {
          id: true,
          sourceVersion: true,
          requestedById: true,
          createdAt: true,
          setting: { select: { key: true, group: true } },
          requestedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      totals: {
        total,
        published,
        drafts,
        publicCount,
        sensitiveCount,
        pendingChangeRequests,
      },
      pendingDrafts: draftRows.map((s) => ({
        id: s.id,
        key: s.key,
        group: s.group,
        isPublic: s.isPublic,
        isSensitive: s.isSensitive,
        version: s.version,
        publishedVersion: s.publishedVersion,
        publishedAt: s.publishedAt,
        updatedAt: s.updatedAt,
        hasPendingRequest: s.changeRequests.length > 0,
      })),
      recentChanges: revisions.map((r) => ({
        id: r.id,
        key: r.setting.key,
        group: r.setting.group,
        publishedVersion: r.publishedVersion,
        sourceVersion: r.sourceVersion,
        action: r.action,
        publishedById: r.publishedById,
        createdAt: r.createdAt,
      })),
      pendingRequests: pendingReqs.map((r) => ({
        id: r.id,
        key: r.setting.key,
        group: r.setting.group,
        sourceVersion: r.sourceVersion,
        requestedBy:
          r.requestedBy?.name ?? r.requestedBy?.email ?? r.requestedById,
        createdAt: r.createdAt,
      })),
    };
  }

  listChangeRequests(status?: SettingChangeRequestStatus) {
    return this.prisma.settingChangeRequest.findMany({
      where: { status: status ?? SettingChangeRequestStatus.PENDING },
      orderBy: { createdAt: "desc" },
      include: {
        setting: {
          select: {
            id: true,
            key: true,
            group: true,
            version: true,
            publishedVersion: true,
            publishedValue: true,
          },
        },
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async approveChangeRequest(id: string, reviewerId: string, note?: string) {
    const approved = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.settingChangeRequest.findUnique({
          where: { id },
          include: { setting: true },
        });
        if (!request) throw new NotFoundException("طلب المراجعة غير موجود");
        if (request.status !== SettingChangeRequestStatus.PENDING) {
          throw new BadRequestException("تمت معالجة طلب المراجعة مسبقًا");
        }
        if (request.requestedById === reviewerId) {
          throw new BadRequestException(
            "لا يمكن لمنشئ التغيير اعتماد التغيير نفسه",
          );
        }
        if (
          request.setting.version !== request.sourceVersion ||
          request.setting.publicationStatus !== SettingPublicationStatus.DRAFT
        ) {
          throw new BadRequestException(
            "تغيّرت المسودة بعد إرسال الطلب. ارفض الطلب وأنشئ طلبًا جديدًا.",
          );
        }
        const publishedVersion = request.setting.publishedVersion + 1;
        const updatedSetting = await tx.setting.update({
          where: { id: request.settingId },
          data: {
            value: request.requestedValue,
            publishedValue: request.requestedValue,
            publicationStatus: SettingPublicationStatus.PUBLISHED,
            publishedVersion,
            publishedAt: new Date(),
          },
        });
        await tx.settingRevision.create({
          data: {
            settingId: request.settingId,
            publishedVersion,
            sourceVersion: request.sourceVersion,
            value: request.requestedValue as Prisma.InputJsonValue,
            action:
              request.requestType === "ROLLBACK"
                ? `APPROVED_ROLLBACK_FROM_${request.rollbackFromVersion}`
                : "APPROVED_PUBLISH",
            publishedById: reviewerId,
          },
        });
        const reviewed = await tx.settingChangeRequest.update({
          where: { id },
          data: {
            status: SettingChangeRequestStatus.APPROVED,
            reviewedById: reviewerId,
            reviewNote: note?.trim() || null,
            reviewedAt: new Date(),
          },
          include: {
            requestedBy: { select: { id: true, name: true, email: true } },
            reviewedBy: { select: { id: true, name: true, email: true } },
          },
        });
        return { request: reviewed, setting: updatedSetting };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.afterMutation(true);
    return approved;
  }

  async rejectChangeRequest(id: string, reviewerId: string, note?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await tx.settingChangeRequest.findUnique({
          where: { id },
        });
        if (!request) throw new NotFoundException("طلب المراجعة غير موجود");
        if (request.status !== SettingChangeRequestStatus.PENDING) {
          throw new BadRequestException("تمت معالجة طلب المراجعة مسبقًا");
        }
        if (request.requestedById === reviewerId) {
          throw new BadRequestException(
            "لا يمكن لمنشئ التغيير مراجعة التغيير نفسه",
          );
        }
        return tx.settingChangeRequest.update({
          where: { id },
          data: {
            status: SettingChangeRequestStatus.REJECTED,
            reviewedById: reviewerId,
            reviewNote: note?.trim() || null,
            reviewedAt: new Date(),
          },
          include: {
            setting: { select: { key: true } },
            requestedBy: { select: { id: true, name: true, email: true } },
            reviewedBy: { select: { id: true, name: true, email: true } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listRevisions(key: string, page: number, limit: number) {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!setting) throw new NotFoundException("الإعداد غير موجود");
    const where = { settingId: setting.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.settingRevision.findMany({
        where,
        orderBy: { publishedVersion: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.settingRevision.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async rollbackToPublishedVersion(
    key: string,
    publishedVersion: number,
    actorId: string,
  ) {
    if (!Number.isInteger(publishedVersion) || publishedVersion < 1) {
      throw new BadRequestException("رقم النسخة المنشورة غير صالح");
    }
    return this.prisma.$transaction(
      async (tx) => {
        const setting = await tx.setting.findUnique({ where: { key } });
        if (!setting) throw new NotFoundException("الإعداد غير موجود");
        if (!setting.isPublic || setting.isSensitive) {
          throw new BadRequestException(
            "يمكن استرجاع الإعدادات العامة غير الحساسة فقط",
          );
        }
        const revision = await tx.settingRevision.findUnique({
          where: {
            settingId_publishedVersion: {
              settingId: setting.id,
              publishedVersion,
            },
          },
        });
        if (!revision)
          throw new NotFoundException("النسخة المنشورة غير موجودة");
        const pending = await tx.settingChangeRequest.findFirst({
          where: {
            settingId: setting.id,
            status: SettingChangeRequestStatus.PENDING,
          },
          select: { id: true },
        });
        if (pending) {
          throw new BadRequestException("يوجد طلب مراجعة مفتوح لهذا الإعداد");
        }
        const updated = await tx.setting.update({
          where: { key },
          data: {
            value: revision.value,
            publicationStatus: SettingPublicationStatus.DRAFT,
            version: { increment: 1 },
          },
        });
        return tx.settingChangeRequest.create({
          data: {
            settingId: setting.id,
            requestedValue: revision.value as Prisma.InputJsonValue,
            sourceVersion: updated.version,
            requestType: "ROLLBACK",
            rollbackFromVersion: publishedVersion,
            requestedById: actorId,
          },
          include: {
            setting: { select: { key: true } },
            requestedBy: { select: { id: true, name: true, email: true } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async discardDraft(key: string) {
    if (key === "system.configVersion") {
      throw new BadRequestException("هذا إعداد داخلي لا يمكن تعديله");
    }
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException("الإعداد غير موجود");
    if (setting.publicationStatus !== SettingPublicationStatus.DRAFT) {
      throw new BadRequestException("لا توجد مسودة غير منشورة");
    }
    if (setting.publishedValue === null) {
      throw new BadRequestException("لا توجد نسخة منشورة سابقة للرجوع إليها");
    }
    const pending = await this.prisma.settingChangeRequest.findFirst({
      where: {
        settingId: setting.id,
        status: SettingChangeRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (pending) {
      throw new BadRequestException(
        "لا يمكن إلغاء المسودة أثناء وجود طلب مراجعة مفتوح",
      );
    }
    const restored = await this.prisma.setting.update({
      where: { key },
      data: {
        value: setting.publishedValue,
        publicationStatus: SettingPublicationStatus.PUBLISHED,
        version: { increment: 1 },
      },
    });
    return this.toAdminSetting(restored);
  }

  async remove(key: string) {
    if (key === "system.configVersion") {
      throw new BadRequestException("هذا إعداد داخلي لا يمكن حذفه");
    }
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException("الإعداد غير موجود");
    if (this.isPublishedPublic(setting)) {
      throw new BadRequestException(
        "لا يمكن حذف إعداد منشور مباشرة. استخدم دورة إيقاف معتمدة بدل حذف التاريخ.",
      );
    }
    await this.prisma.setting.delete({ where: { key } });
    await this.afterMutation(this.isPublishedPublic(setting));
    return { success: true };
  }

  private assertVisibility(isPublic?: boolean, isSensitive?: boolean) {
    if (isPublic && isSensitive) {
      throw new BadRequestException(
        "لا يمكن جعل الإعداد عامًا وحساسًا في الوقت نفسه",
      );
    }
  }

  private assertPublishedVisibilityUnchanged(
    existing:
      | {
          isPublic: boolean;
          isSensitive: boolean;
          publicationStatus: SettingPublicationStatus;
          publishedValue: Prisma.JsonValue | null;
        }
      | null
      | undefined,
    nextIsPublic: boolean,
    nextIsSensitive: boolean,
  ) {
    if (
      this.isPublishedPublic(existing) &&
      (!nextIsPublic || nextIsSensitive)
    ) {
      throw new BadRequestException(
        "لا يمكن تغيير ظهور إعداد منشور مباشرة لأن ذلك يتجاوز الموافقة المزدوجة",
      );
    }
  }

  private toAdminSetting<
    T extends {
      value: Prisma.JsonValue;
      isSensitive: boolean;
    },
  >(row: T) {
    return {
      ...row,
      value: row.isSensitive ? null : row.value,
      hasValue: row.value !== null && row.value !== "",
      masked: row.isSensitive,
    };
  }

  private isPublishedPublic(
    setting:
      | {
          isPublic: boolean;
          isSensitive: boolean;
          publicationStatus: SettingPublicationStatus;
          publishedValue: Prisma.JsonValue | null;
        }
      | null
      | undefined,
  ): boolean {
    return Boolean(
      setting?.isPublic &&
      !setting.isSensitive &&
      setting.publicationStatus === SettingPublicationStatus.PUBLISHED &&
      setting.publishedValue !== null,
    );
  }

  private async afterMutation(publicConfigChanged: boolean) {
    if (!publicConfigChanged) return;
    this.publicCache = null;
    await this.versions.bump();
  }
}
