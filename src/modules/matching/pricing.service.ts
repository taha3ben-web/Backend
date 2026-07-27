import { Injectable } from "@nestjs/common";
import { RideClass } from "@prisma/client";
import {
  PricingEngineService,
  PricingContext,
} from "../pricing-engine/pricing-engine.service";

/**
 * شكل نتيجة تقدير الأجرة (يُحافَظ عليه للتوافق مع المستدعين الحاليين). */
export interface FareQuote {
  distanceKm: number;
  durationSec: number;
  fare: number;
  currency: string;
  commissionPct: number;
  experimentVariant: string | null;
  /** مسار الرحلة الفعلي من محرك التوجيه (إن توفّر). */
  route?: {
    polyline: string;
    provider: string;
    source: string;
    approximate: boolean;
  };
  breakdown: {
    baseFare: number;
    distanceCost: number;
    timeCost: number;
    peakMultiplier: number;
    minFare: number;
    maxFare: number | null;
    negotiationMin: number | null;
    negotiationMax: number | null;
    taxNet: number;
    taxAmount: number;
    taxGross: number;
    countryCode: string | null;
  };
}

export interface QuoteOptions {
  rideClass?: RideClass;
  vehicleTypeId?: string;
  cityId?: string;
  serviceAreaId?: string;
  state?: string;
  country?: string;
  customerType?: string;
  couponCode?: string;
  subjectId?: string;
}

/**
 * غلاف رقيق حول محرك التسعير المستقل (PricingEngineService).
 * يحافظ على التوقيع القديم (quote) حتى لا تنكسر المطابقة،
 * بينما انتقل منطق التسعير بالكامل إلى المحرك المستقل.
 */
@Injectable()
export class PricingService {
  constructor(private readonly engine: PricingEngineService) {}

  async quote(
    pickupLat: number,
    pickupLng: number,
    destLat: number,
    destLng: number,
    rideClassOrOptions: RideClass | QuoteOptions = "ECONOMY",
    cityId?: string,
  ): Promise<FareQuote> {
    const opts: QuoteOptions =
      typeof rideClassOrOptions === "object"
        ? rideClassOrOptions
        : { rideClass: rideClassOrOptions, cityId };

    const ctx: PricingContext = {
      ...opts,
      pickupLat,
      pickupLng,
      destLat,
      destLng,
    };
    const r = await this.engine.quote(ctx);

    return {
      distanceKm: r.distanceKm,
      durationSec: r.durationSec,
      fare: r.fare,
      currency: r.currency,
      commissionPct: r.commissionPct,
      experimentVariant: r.experimentVariant,
      route: r.route,
      breakdown: {
        baseFare: r.breakdown.baseFare,
        distanceCost: r.breakdown.distanceCost,
        timeCost: r.breakdown.timeCost,
        peakMultiplier: r.breakdown.peakMultiplier,
        minFare: r.breakdown.minFare,
        maxFare: r.breakdown.maxFare,
        negotiationMin: r.breakdown.negotiationMin,
        negotiationMax: r.breakdown.negotiationMax,
        taxNet: r.breakdown.taxNet,
        taxAmount: r.breakdown.taxAmount,
        taxGross: r.breakdown.taxGross,
        countryCode: r.breakdown.countryCode,
      },
    };
  }
}
