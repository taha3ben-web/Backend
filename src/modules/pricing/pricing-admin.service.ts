import { DEFAULT_CURRENCY } from "../../common/money.util";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreatePeakPricingDto,
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
} from "./dto/pricing.dto";

/**
 * إدارة قواعد التسعير وتسعير الذروة (للوحة التحكم).
 * حساب الأجرة نفسه في PricingService داخل وحدة المطابقة.
 */
@Injectable()
export class PricingAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- قواعد التسعير ----------

  listRules() {
    return this.prisma.pricingRule.findMany({
      orderBy: [{ cityId: "asc" }, { rideClass: "asc" }],
      include: {
        city: { select: { name: true } },
        peakPricing: true,
      },
    });
  }

  async createRule(dto: CreatePricingRuleDto) {
    return this.prisma.pricingRule.create({
      data: {
        cityId: dto.cityId,
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
    await this.getRule(id);
    return this.prisma.pricingRule.update({
      where: { id },
      data: {
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
