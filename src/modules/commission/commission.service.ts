import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  CommissionContext,
  CommissionRuleCandidate,
  isValidCommissionPct,
  pickCommissionRule,
} from "./commission-resolution.util";
import {
  CreateCommissionRuleDto,
  UpdateCommissionRuleDto,
} from "./dto/commission.dto";

/**
 * مفتاح الإعداد المركزي لنسبة العمولة الافتراضية على مستوى المنصّة.
 * يُدار من نفس شاشة الإعدادات القائمة (`Setting`) التي تديرها اللوحة،
 * فلا يوجد نظام إعدادات موازٍ. القيمة المتوقعة: `{ "pct": <number> }`.
 */
export const COMMISSION_DEFAULT_SETTING_KEY = "commission.defaultPct";

/** من أين جاءت النسبة فعليًا — يُخزَّن في أحداث الرحلة للتدقيق. */
export type CommissionSource =
  | "COMMISSION_RULE"
  | "VEHICLE_PRICING_RULE"
  | "PLATFORM_SETTING";

export interface ResolvedCommission {
  commissionPct: number;
  /** معرّف قاعدة العمولة المستخدمة (null إن جاءت من تجاوز/إعداد عام). */
  ruleId: string | null;
  source: CommissionSource;
}

export interface ResolveCommissionInput extends CommissionContext {
  /**
   * تجاوز اختياري محفوظ على قاعدة سعر المركبة المستخدمة في التسعير.
   * موجود للتوافق مع القواعد المضبوطة قبل هذا التصحيح: إن كانت اللوحة قد
   * ضبطت نسبة هناك فهي إعداد لوحة صالح ولا يجوز تجاهله. null = لا تجاوز.
   */
  vehiclePricingRuleCommissionPct?: number | null;
}

/**
 * السلطة الوحيدة على نسبة عمولة المنصّة.
 *
 * تطبيق الراكب وتطبيق السائق لا يملكان أي رأي في العمولة: النسبة تُحلّ في
 * الخادم من إعدادات لوحة التحكم، ثم **تُلتقط على الرحلة** (`Trip.commissionPct`
 * و `Trip.commissionRuleId`) وقت الإنشاء. تغيير الإعداد بعد ذلك لا يعيد كتابة
 * محاسبة أي رحلة سابقة، لأن التسوية تقرأ اللقطة من الرحلة لا من الإعداد.
 */
@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * يحلّ النسبة الفعّالة لسياق معيّن.
   *
   * الترتيب:
   *   1. `CommissionRule` (دولة/مدينة/نوع/فئة) — المصدر المعتمد.
   *   2. تجاوز `VehiclePricingRule.commissionPct` إن ضُبط من اللوحة.
   *   3. إعداد اللوحة المركزي `commission.defaultPct`.
   *   4. خطأ نطاق `COMMISSION_NOT_CONFIGURED` — ولا نسبة مبرمَجة أبدًا.
   */
  async resolve(input: ResolveCommissionInput): Promise<ResolvedCommission> {
    const ctx = await this.completeContext(input);
    const rules = await this.loadCandidates(ctx);
    const picked = pickCommissionRule(rules, ctx);
    if (picked) {
      return {
        commissionPct: picked.commissionPct,
        ruleId: picked.id,
        source: "COMMISSION_RULE",
      };
    }

    const override = input.vehiclePricingRuleCommissionPct;
    if (override != null && isValidCommissionPct(override)) {
      return {
        commissionPct: override,
        ruleId: null,
        source: "VEHICLE_PRICING_RULE",
      };
    }

    const fallback = await this.platformDefaultPct();
    if (fallback != null) {
      return {
        commissionPct: fallback,
        ruleId: null,
        source: "PLATFORM_SETTING",
      };
    }

    this.logger.error(
      `لا توجد قاعدة عمولة مضبوطة للسياق: ${JSON.stringify(ctx)} — ولا إعداد ${COMMISSION_DEFAULT_SETTING_KEY}`,
    );
    throw new AppException("COMMISSION_NOT_CONFIGURED", { details: ctx });
  }

  /**
   * نفس منطق `resolve` لكن للوحة التحكم: يُرجع النسبة الفعّالة والقاعدة
   * المستخدمة وكل القواعد المرشّحة، ليرى الموظف **لماذا** خرجت هذه النسبة.
   */
  async effective(input: ResolveCommissionInput) {
    const ctx = await this.completeContext(input);
    const rules = await this.loadCandidates(ctx);
    const picked = pickCommissionRule(rules, ctx);
    const resolved = await this.resolve(input).catch((error: unknown) => {
      if (error instanceof AppException) return null;
      throw error;
    });
    return {
      context: ctx,
      effective: resolved,
      configured: resolved !== null,
      matchedRuleId: picked?.id ?? null,
      candidates: rules.map((rule) => ({
        id: rule.id,
        countryCode: rule.countryCode,
        cityId: rule.cityId,
        vehicleTypeId: rule.vehicleTypeId,
        vehicleCategoryId: rule.vehicleCategoryId,
        commissionPct: rule.commissionPct,
        priority: rule.priority,
      })),
    };
  }

  /**
   * يكمل السياق خادميًا: الدولة من المدينة، وفئة المركبة من نوعها.
   * لا نقبل أي بُعد مشتق من العميل (نفس مبدأ اشتقاق الولاية في التسعير):
   * لو قبلناه لأمكن ادّعاء نطاق بعمولة أقل.
   */
  private async completeContext(
    input: CommissionContext,
  ): Promise<CommissionContext> {
    let countryCode = input.countryCode?.trim().toUpperCase() || null;
    let vehicleCategoryId = input.vehicleCategoryId ?? null;

    if (!countryCode && input.cityId) {
      const city = await this.prisma.city.findUnique({
        where: { id: input.cityId },
        select: { country: true },
      });
      countryCode = city?.country?.trim().toUpperCase() || null;
    }
    if (!vehicleCategoryId && input.vehicleTypeId) {
      const type = await this.prisma.vehicleType.findUnique({
        where: { id: input.vehicleTypeId },
        select: { categoryId: true },
      });
      vehicleCategoryId = type?.categoryId ?? null;
    }

    return {
      countryCode,
      cityId: input.cityId ?? null,
      vehicleTypeId: input.vehicleTypeId ?? null,
      vehicleCategoryId,
    };
  }

  /**
   * يجلب القواعد التي **يمكن** أن تنطبق: كل بُعد إمّا null (wildcard) أو
   * مساوٍ لقيمة السياق. الفلترة النهائية والترتيب في الدالة النقية.
   */
  private async loadCandidates(
    ctx: CommissionContext,
  ): Promise<CommissionRuleCandidate[]> {
    // بُعد غير محدَّد في السياق ⇒ تُقبل القواعد التي تركته null فقط.
    // بُعد محدَّد ⇒ تُقبل القواعد المطابقة له أو التي تركته null (wildcard).
    // نستخدم OR صريحًا لأن Prisma لا يسمح بـ`in: [value, null]` على عمود نصي.
    const dimension = (
      field:
        | "countryCode"
        | "cityId"
        | "vehicleTypeId"
        | "vehicleCategoryId",
      value: string | null | undefined,
    ): Prisma.CommissionRuleWhereInput =>
      value == null
        ? { [field]: null }
        : { OR: [{ [field]: value }, { [field]: null }] };

    const rows = await this.prisma.commissionRule.findMany({
      where: {
        isActive: true,
        AND: [
          dimension("countryCode", ctx.countryCode),
          dimension("cityId", ctx.cityId),
          dimension("vehicleTypeId", ctx.vehicleTypeId),
          dimension("vehicleCategoryId", ctx.vehicleCategoryId),
        ],
      },
      select: {
        id: true,
        countryCode: true,
        cityId: true,
        vehicleTypeId: true,
        vehicleCategoryId: true,
        commissionPct: true,
        priority: true,
        isActive: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /** إعداد اللوحة المركزي، أو null إن لم يُضبط/كان غير صالح. */
  private async platformDefaultPct(): Promise<number | null> {
    const setting = await this.prisma.setting
      .findUnique({ where: { key: COMMISSION_DEFAULT_SETTING_KEY } })
      .catch(() => null);
    if (!setting) return null;
    const raw = (setting.publishedValue ?? setting.value) as unknown;
    const pct =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object"
          ? Number((raw as { pct?: unknown }).pct)
          : Number(raw);
    return isValidCommissionPct(pct) ? pct : null;
  }

  // ===================== إدارة اللوحة (Dashboard CRUD) =====================

  async list(
    q: PaginationDto,
    filters: {
      countryCode?: string;
      cityId?: string;
      vehicleTypeId?: string;
      vehicleCategoryId?: string;
      isActive?: boolean;
    } = {},
  ) {
    const where: Prisma.CommissionRuleWhereInput = {
      ...(filters.countryCode
        ? { countryCode: filters.countryCode.trim().toUpperCase() }
        : {}),
      ...(filters.cityId ? { cityId: filters.cityId } : {}),
      ...(filters.vehicleTypeId
        ? { vehicleTypeId: filters.vehicleTypeId }
        : {}),
      ...(filters.vehicleCategoryId
        ? { vehicleCategoryId: filters.vehicleCategoryId }
        : {}),
      ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
      ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commissionRule.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          city: { select: { id: true, name: true, country: true } },
          vehicleType: { select: { id: true, name: true } },
          vehicleCategory: { select: { id: true, name: true } },
        },
      }),
      this.prisma.commissionRule.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const rule = await this.prisma.commissionRule.findUnique({
      where: { id },
      include: {
        city: { select: { id: true, name: true, country: true } },
        vehicleType: { select: { id: true, name: true } },
        vehicleCategory: { select: { id: true, name: true } },
      },
    });
    if (!rule) {
      throw new AppException("COMMISSION_RULE_NOT_FOUND", { details: { id } });
    }
    return rule;
  }

  async create(dto: CreateCommissionRuleDto, actorId?: string) {
    if (!isValidCommissionPct(dto.commissionPct)) {
      throw new AppException("COMMISSION_RULE_INVALID", {
        details: { commissionPct: dto.commissionPct },
      });
    }
    return this.prisma.commissionRule.create({
      data: {
        name: dto.name ?? null,
        countryCode: dto.countryCode?.trim().toUpperCase() || null,
        cityId: dto.cityId ?? null,
        vehicleTypeId: dto.vehicleTypeId ?? null,
        vehicleCategoryId: dto.vehicleCategoryId ?? null,
        commissionPct: dto.commissionPct,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
        note: dto.note ?? null,
        createdById: actorId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateCommissionRuleDto) {
    await this.findOne(id);
    if (
      dto.commissionPct !== undefined &&
      !isValidCommissionPct(dto.commissionPct)
    ) {
      throw new AppException("COMMISSION_RULE_INVALID", {
        details: { commissionPct: dto.commissionPct },
      });
    }
    return this.prisma.commissionRule.update({
      where: { id },
      data: {
        name: dto.name,
        countryCode:
          dto.countryCode === undefined
            ? undefined
            : dto.countryCode?.trim().toUpperCase() || null,
        cityId: dto.cityId,
        vehicleTypeId: dto.vehicleTypeId,
        vehicleCategoryId: dto.vehicleCategoryId,
        commissionPct: dto.commissionPct,
        priority: dto.priority,
        isActive: dto.isActive,
        note: dto.note,
      },
    });
  }

  /**
   * تعطيل لا حذف: الرحلات السابقة تشير إلى القاعدة عبر `commissionRuleId`
   * للتدقيق، وحذف الصف يُفقد هذا الأثر.
   */
  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.commissionRule.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
