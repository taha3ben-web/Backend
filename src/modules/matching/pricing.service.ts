import { Injectable } from "@nestjs/common";
import { RideClass } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { haversineKm, estimateDurationSec } from "./geo.util";
import { computeFare } from "./pricing.util";

export interface FareQuote {
  distanceKm: number;
  durationSec: number;
  fare: number;
  currency: string;
  breakdown: {
    baseFare: number;
    distanceCost: number;
    timeCost: number;
    peakMultiplier: number;
    minFare: number;
    maxFare: number | null;
  };
}

// قيم احتياطية إن لم توجد قاعدة تسعير في قاعدة البيانات
const DEFAULT_RULE = {
  baseFare: 50,
  perKm: 20,
  perMin: 3,
  minFare: 100,
  maxFare: null as number | null,
  currency: "DZD",
};

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * تقدير الأجرة: يبحث عن قاعدة تسعير حسب المدينة والفئة،
   * يحسب المسافة/الزمن، ويطبق تسعير الذروة إن كان فعّالًا الآن.
   */
  async quote(
    pickupLat: number,
    pickupLng: number,
    destLat: number,
    destLng: number,
    rideClass: RideClass = "ECONOMY",
    cityId?: string,
  ): Promise<FareQuote> {
    const rule = await this.resolveRule(rideClass, cityId);
    const distanceKm =
      Math.round(haversineKm(pickupLat, pickupLng, destLat, destLng) * 100) /
      100;
    const durationSec = estimateDurationSec(distanceKm);
    const baseFare = Number(rule.baseFare);
    const minFare = Number(rule.minFare);
    const maxFare = rule.maxFare != null ? Number(rule.maxFare) : null;
    const peakMultiplier = await this.currentPeakMultiplier(rule.id);

    const { fare, distanceCost, timeCost } = computeFare(
      {
        baseFare,
        perKm: Number(rule.perKm),
        perMin: Number(rule.perMin),
        minFare,
        maxFare,
      },
      distanceKm,
      durationSec,
      peakMultiplier,
    );

    return {
      distanceKm,
      durationSec,
      fare,
      currency: rule.currency,
      breakdown: {
        baseFare,
        distanceCost,
        timeCost,
        peakMultiplier,
        minFare,
        maxFare,
      },
    };
  }

  private async resolveRule(rideClass: RideClass, cityId?: string) {
    // أولاً: قاعدة خاصة بالمدينة + الفئة، ثم عامة بالفئة
    const rule =
      (cityId
        ? await this.prisma.pricingRule.findFirst({
            where: { cityId, rideClass, isActive: true },
          })
        : null) ??
      (await this.prisma.pricingRule.findFirst({
        where: { rideClass, isActive: true },
        orderBy: { createdAt: "asc" },
      }));

    if (rule) return rule;
    return { id: null as string | null, ...DEFAULT_RULE };
  }

  /** مضاعف الذروة الفعّال الآن (اليوم + الوقت)، وإلا 1 */
  private async currentPeakMultiplier(ruleId: string | null): Promise<number> {
    if (!ruleId) return 1;
    const peaks = await this.prisma.peakPricing.findMany({
      where: { pricingRuleId: ruleId, isActive: true },
    });
    if (peaks.length === 0) return 1;

    const now = new Date();
    const day = now.getDay(); // 0=الأحد
    const hm = now.getHours() * 60 + now.getMinutes();

    for (const p of peaks) {
      if (p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(day)) continue;
      const start = this.parseHm(p.startTime);
      const end = this.parseHm(p.endTime);
      const active =
        start <= end ? hm >= start && hm <= end : hm >= start || hm <= end;
      if (active) return p.multiplier;
    }
    return 1;
  }

  private parseHm(value: string): number {
    const [h, m] = value.split(":").map((n) => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  }
}
