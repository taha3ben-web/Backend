import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  BulkUpsertSettingsDto,
  UpdateSettingValueDto,
  UpsertSettingDto,
} from "./dto/settings.dto";

/**
 * خدمة الإعدادات: تخزين key/value (JSON) مع تجميع اختياري.
 * تغطي: اسم التطبيق، الشعار، الألوان، اللغات، العملة، الخصوصية، الشروط،
 * إعدادات Firebase/الخرائط/الإشعارات/البريد/الرسائل، إلخ.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(group?: string) {
    return this.prisma.setting.findMany({
      where: group ? { group } : undefined,
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });
  }

  async findOne(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException("الإعداد غير موجود");
    return setting;
  }

  /** إرجاع قيمة الإعداد فقط مع قيمة افتراضية إن لم يوجد (للاستخدام الداخلي). */
  async getValue<T = unknown>(key: string, fallback?: T): Promise<T> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) return fallback as T;
    return setting.value as T;
  }

  async upsert(dto: UpsertSettingDto) {
    return this.prisma.setting.upsert({
      where: { key: dto.key },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
      },
      create: {
        key: dto.key,
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
      },
    });
  }

  async updateValue(key: string, dto: UpdateSettingValueDto) {
    return this.prisma.setting.upsert({
      where: { key },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
      },
      create: {
        key,
        value: dto.value as Prisma.InputJsonValue,
        group: dto.group,
      },
    });
  }

  async bulkUpsert(dto: BulkUpsertSettingsDto) {
    return this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.setting.upsert({
          where: { key: item.key },
          update: {
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
          },
          create: {
            key: item.key,
            value: item.value as Prisma.InputJsonValue,
            group: item.group,
          },
        }),
      ),
    );
  }

  async remove(key: string) {
    await this.findOne(key);
    await this.prisma.setting.delete({ where: { key } });
    return { success: true };
  }
}
