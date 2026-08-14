import { DEFAULT_CURRENCY } from "../../common/money.util";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreatePeakPricingDto,
  CreatePricingRuleDto,
  UpdatePricingFeesDto,
  UpdatePricingRuleDto,
} from "./dto/pricing.dto";
import { SettingsService } from "../settings/settings.service";
import {
  DEFAULT_PRICING_FEES,
  PRICING_FEES_SETTING_KEY,
  PricingPolicyService,
  type PricingFeesSetting,
} from "../pricing-engine/pricing-policy.service";

/**
 * إدارة قواعد التسعير وتسعير الذروة ورسوم الأجرة (للوحة التحكم).
 * حساب الأجرة نفسه في PricingEngineService — هذه الخدمة إدارية فقط
 * ولا تحسب أي أجرة بنفسها.
 */
@Injectable()
export class PricingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly policy: PricingPolicyService,
  ) {}

  // ---------- رسوم الأجرة المركزية (المرحلة 7) ----------

  /**
   * قراءة سياسة الرسوم الحالية مع ما يلزم اللوحة لعرضها.
   * القيم تأتي من Setting واحد (pricing.fees) لا من جدول جديد.
   */
  async getFees() {
    const fees = await this.policy.fees();
    return {
      key: PRICING_FEES_SETTING_KEY,
      fees,
      defaults: DEFAULT_PRICING_FEES,
      /** ملخّص للوحة: أي رسوم تؤثر فعليًا على الأجرة الآن. */
      active: {
        serviceFee: fees.serviceFee > 0,
        waiting: fees.waiting.enabled && fees.waiting.perMinute > 0,
        cancellation:
          fees.cancellation.enabled &&
          (fees.cancellation.feeAfterAccept > 0 ||
            fees.cancellation.feeAfterArrival > 0),
        negotiation: fees.negotiation.bandPct > 0,
      },
    };
  }

  /**
   * تحديث جزئي لسياسة الرسوم. يدمج مع القيم الحالية ثم يُطبّع ويحفظ.
   * يمرّ عبر SettingsService.upsert فيستفيد من التدقيق وإبطال الكاش القائمين.
   */
  async updateFees(dto: UpdatePricingFeesDto) {
    const current = await this.policy.fees();
    const merged: PricingFeesSetting = this.policy.normalize({
      serviceFee: dto.serviceFee ?? current.serviceFee,
      waiting: { ...current.waiting, ...(dto.waiting ?? {}) },
      cancellation: {
        ...current.cancellation,
        ...(dto.cancellation ?? {}),
      },
      negotiation: {
        ...current.negotiation,
        ...(dto.negotiation ?? {}),
      },
    });
    await this.settings.upsert({
      key: PRICING_FEES_SETTING_KEY,
      value: merged,
      group: "pricing",
      isPublic: false,
      isSensitive: false,
    });
    return this.getFees();
  }

  // ---------- قواعد التسعير ----------

  listRules() {
    return this.prisma.pricingRule.findMany({
      // الترتيب يعكس أولوية التطبيق لكي تقرأ الإدارة الجدول كما يراه المحرك.
      orderBy: [{ cityId: "asc" }, { wilayaId: "asc" }, { rideClass: "asc" }],
      include: {
        city: { select: { name: true } },
        wilaya: { select: { number: true, nameAr: true, nameFr: true } },
        peakPricing: true,
      },
    });
  }

  async createRule(dto: CreatePricingRuleDto) {
    return this.prisma.pricingRule.create({
      data: {
        cityId: dto.cityId,
        // لا نخزّن wilayaId مع cityId: المدينة تعرف ولايتها أصلًا، وتخزينهما معًا
        // يخلق مصدري حقيقة يمكن أن يتناقضا إذا نُقلت المدينة إلى ولاية أخرى.
        wilayaId: dto.cityId ? null : (dto.wilayaId ?? null),
        rideClass: dto.rideClass ?? "ECONOMY",
        baseFare: dto.baseFare,
        perKm: dto.perKm,
        perMin: dto.perMin,
        minFare: dto.minFare,
        maxFare: dto.maxFare,
        currency: dto.currency ?? DEFAULT_CURRENCY,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateRule(id: string, dto: UpdatePricingRuleDto) {
    const current = await this.getRule(id);

    // تغيير النطاق الجغرافي: يُطبّق نفس الحارس الموجود في الإنشاء.
    const nextCityId =
      dto.cityId !== undefined ? (dto.cityId ?? null) : current.cityId;
    const nextWilayaId = nextCityId
      ? null
      : dto.wilayaId !== undefined
        ? (dto.wilayaId ?? null)
        : current.wilayaId;

    return this.prisma.pricingRule.update({
      where: { id },
      data: {
        ...(dto.cityId !== undefined || dto.wilayaId !== undefined
          ? { cityId: nextCityId, wilayaId: nextWilayaId }
          : {}),
        baseFare: dto.baseFare,
        perKm: dto.perKm,
        perMin: dto.perMin,
        minFare: dto.minFare,
        maxFare: dto.maxFare,
        currency: dto.currency,
        isActive: dto.isActive,
      },
    });
  }

  async deleteRule(id: string) {
    await this.getRule(id);
    await this.prisma.pricingRule.delete({ where: { id } });
    return { ok: true };
  }

  private async getRule(id: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("قاعدة التسعير غير موجودة");
    return rule;
  }

  // ---------- تسعير الذروة ----------

  async createPeak(dto: CreatePeakPricingDto) {
    await this.getRule(dto.pricingRuleId);
    return this.prisma.peakPricing.create({
      data: {
        pricingRuleId: dto.pricingRuleId,
        name: dto.name,
        multiplier: dto.multiplier,
        startTime: dto.startTime,
        endTime: dto.endTime,
        daysOfWeek: dto.daysOfWeek ?? [],
        isActive: dto.isActive ?? true,
      },
    });
  }

  async deletePeak(id: string) {
    const peak = await this.prisma.peakPricing.findUnique({ where: { id } });
    if (!peak) throw new NotFoundException("تسعير الذروة غير موجود");
    await this.prisma.peakPricing.delete({ where: { id } });
    return { ok: true };
  }
}
