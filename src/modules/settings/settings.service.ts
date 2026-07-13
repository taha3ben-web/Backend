import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    });
    return rows.map((row) => this.toAdminSetting(row));
  }

  async findOne(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting || key === "system.configVersion") {
      throw new NotFoundException("الإعداد غير موجود");
    }
    return this.toAdminSetting(setting);
  }

  async getValue<T = unknown>(key: string, fallback?: T): Promise<T> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) return fallback as T;
    return setting.value as T;
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
          key: { not: "system.configVersion" },
        },
        orderBy: { key: "asc" },
        select: { key: true, value: true, version: true, updatedAt: true },
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
      values[setting.key] = setting.value;
      settingVersions[setting.key] = setting.version;
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

    const saved = await this.prisma.setting.upsert({
      where: { key: dto.key },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        ...(dto.group !== undefined ? { group: dto.group || null } : {}),
        ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        ...(dto.isSensitive !== undefined
          ? { isSensitive: dto.isSensitive }
          : {}),
        version: { increment: 1 },
      },
      create: {
        key: dto.key,
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
        isPublic,
        isSensitive: sensitivity,
      },
    });
    await this.afterMutation();
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
          },
        });
    await this.afterMutation();
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

    const saved = await this.prisma.$transaction(
      dto.items.map((item) => {
        const current = byKey.get(item.key);
        const sensitivity = item.isSensitive ?? current?.isSensitive ?? false;
        const isPublic = item.isPublic ?? current?.isPublic ?? false;
        this.assertVisibility(isPublic, sensitivity);
        return this.prisma.setting.upsert({
          where: { key: item.key },
          update: {
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
            isPublic,
            isSensitive: sensitivity,
            version: { increment: 1 },
          },
          create: {
            key: item.key,
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
            isPublic,
            isSensitive: sensitivity,
          },
        });
      }),
    );
    await this.afterMutation();
    return saved.map((row) => this.toAdminSetting(row));
  }

  async remove(key: string) {
    if (key === "system.configVersion") {
      throw new BadRequestException("هذا إعداد داخلي لا يمكن حذفه");
    }
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException("الإعداد غير موجود");
    await this.prisma.setting.delete({ where: { key } });
    await this.afterMutation();
    return { success: true };
  }

  private assertVisibility(isPublic?: boolean, isSensitive?: boolean) {
    if (isPublic && isSensitive) {
      throw new BadRequestException(
        "لا يمكن جعل الإعداد عامًا وحساسًا في الوقت نفسه",
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

  private async afterMutation() {
    this.publicCache = null;
    return this.versions.bump();
  }
}
