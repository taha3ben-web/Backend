import { Injectable } from "@nestjs/common";
import { FareQuote, FareQuoteStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import { round2 } from "../../common/money.util";
import {
  PricingEngineService,
  type PricingContext,
  type PricingResult,
} from "../pricing-engine/pricing-engine.service";
import {
  CreateFareQuoteDto,
  AdminFareQuoteQueryDto,
  SimulateFareQuoteDto,
} from "./dto/fare-quote.dto";

/** مدّة صلاحية العرض (دقائق) من البيئة مع افتراض آمن. */
const QUOTE_TTL_MINUTES = Number(process.env.FARE_QUOTE_TTL_MINUTES) || 5;
/** عرض نطاق التفاوض الافتراضي (±نسبة) عند غياب حدود القاعدة. */
const DEFAULT_BAND_PCT = Math.min(
  Math.max(Number(process.env.FARE_QUOTE_BAND_PCT) || 0.2, 0),
  0.9,
);

interface NegotiationBand {
  suggested: number;
  min: number;
  max: number;
}

/**
 * خدمة عرض السعر التفاوضي (FareQuote — نموذج inDrive).
 * تبني فوق محرك التسعير القائم: تولّد سعرًا مقترَحًا ونطاق تفاوض [min,max]،
 * ثم تسمح للراكب باقتراح سعره ضمن النطاق. (عروض السائقين المضادة = مرحلة لاحقة).
 */
@Injectable()
export class FareQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: PricingEngineService,
  ) {}

  /**
   * يبني سياق التسعير من مدخلات الراكب.
   *
   * المرحلة 7: لم تعد المسافة والمدة تمرّ من الراكب إطلاقًا؛ يحسبهما
   * محرك التسعير من الإحداثيات عبر مزوّد التوجيه. الاستثناء الوحيد هو
   * محاكاة اللوحة (STAFF) عبر allowClientMetrics.
   */
  private buildContext(
    dto: CreateFareQuoteDto | SimulateFareQuoteDto,
    allowClientMetrics = false,
  ): PricingContext {
    const simulated = allowClientMetrics
      ? (dto as SimulateFareQuoteDto)
      : undefined;
    return {
      vehicleTypeId: dto.vehicleTypeId,
      rideClass: dto.rideClass,
      cityId: dto.cityId,
      serviceAreaId: dto.serviceAreaId,
      state: dto.state,
      country: dto.country,
      customerType: dto.customerType,
      couponCode: dto.couponCode,
      distanceKm: simulated?.distanceKm,
      durationSec: simulated?.durationSec,
      trustClientMetrics:
        allowClientMetrics &&
        simulated?.distanceKm != null &&
        simulated?.durationSec != null,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      destLat: dto.destLat,
      destLng: dto.destLng,
    };
  }

  /**
   * يشتق نطاق التفاوض: يفضّل حدود القاعدة (negotiationMin/Max) إن وُجدت،
   * وإلا يشتق نطاقًا افتراضيًا حول السعر المقترَح مع احترام الحد الأدنى للأجرة.
   */
  private computeBand(result: PricingResult): NegotiationBand {
    const suggested = round2(result.fare);
    const floor = result.breakdown.minFare > 0 ? result.breakdown.minFare : 0;
    const ruleMin = result.breakdown.negotiationMin;
    const ruleMax = result.breakdown.negotiationMax;

    let min =
      ruleMin != null ? ruleMin : round2(suggested * (1 - DEFAULT_BAND_PCT));
    let max =
      ruleMax != null ? ruleMax : round2(suggested * (1 + DEFAULT_BAND_PCT));

    // الحد الأدنى لا ينزل تحت أرضية الأجرة ولا يكون سالبًا.
    min = Math.max(min, floor, 0);
    // ضمان ترتيب منطقي: min ≤ suggested ≤ max.
    if (suggested > 0) {
      min = Math.min(min, suggested);
      max = Math.max(max, suggested);
    }
    if (max < min) max = min;

    return { suggested, min: round2(min), max: round2(max) };
  }

  /** يحسب العرض والنطاق دون حفظ (يُستخدم في الإنشاء والمحاكاة). */
  private async price(
    dto: CreateFareQuoteDto | SimulateFareQuoteDto,
    allowClientMetrics = false,
  ): Promise<{
    result: PricingResult;
    band: NegotiationBand;
  }> {
    const result = await this.engine.quote(
      this.buildContext(dto, allowClientMetrics),
    );
    return { result, band: this.computeBand(result) };
  }

  /** إنشاء عرض سعر تفاوضي للراكب. */
  async createQuote(userId: string, dto: CreateFareQuoteDto) {
    const { result, band } = await this.price(dto);
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000);
    const quote = await this.prisma.fareQuote.create({
      data: {
        passengerId: userId,
        rideClass: dto.rideClass ?? "ECONOMY",
        vehicleTypeId: dto.vehicleTypeId ?? null,
        cityId: dto.cityId ?? null,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        pickupAddress: dto.pickupAddress ?? null,
        destLat: dto.destLat ?? null,
        destLng: dto.destLng ?? null,
        destAddress: dto.destAddress ?? null,
        distanceKm: result.distanceKm,
        durationSec: result.durationSec,
        currency: result.currency,
        suggestedFare: new Prisma.Decimal(band.suggested),
        minFare: new Prisma.Decimal(band.min),
        maxFare: new Prisma.Decimal(band.max),
        commissionPct: result.commissionPct,
        pricingSource: result.ruleUsed.source,
        pricingRuleId: result.ruleUsed.id,
        status: "QUOTED",
        expiresAt,
      },
    });
    return this.serialize(quote);
  }

  /** اقتراح الراكب لسعر ضمن النطاق. */
  async proposeFare(
    userId: string,
    id: string,
    fare: number,
    note?: string,
  ) {
    const quote = await this.owned(userId, id);
    if (this.isExpired(quote)) {
      await this.markExpired(quote.id);
      throw new AppException("FARE_QUOTE_EXPIRED");
    }
    if (quote.status !== "QUOTED" && quote.status !== "PROPOSED") {
      throw new AppException("FARE_QUOTE_INVALID_STATE");
    }
    const min = Number(quote.minFare);
    const max = Number(quote.maxFare);
    const proposed = round2(fare);
    if (proposed < min || proposed > max) {
      throw new AppException("FARE_OFFER_OUT_OF_RANGE", {
        details: { min, max, proposed },
      });
    }
    const updated = await this.prisma.fareQuote.update({
      where: { id: quote.id },
      data: {
        proposedFare: new Prisma.Decimal(proposed),
        status: "PROPOSED",
        proposedAt: new Date(),
        passengerNote: note?.trim() ? note.trim() : null,
      },
    });
    return this.serialize(updated);
  }

  /** إلغاء العرض. */
  async cancel(userId: string, id: string) {
    const quote = await this.owned(userId, id);
    if (quote.status === "ACCEPTED") {
      throw new AppException("FARE_QUOTE_INVALID_STATE");
    }
    const updated = await this.prisma.fareQuote.update({
      where: { id: quote.id },
      data: { status: "CANCELLED" },
    });
    return this.serialize(updated);
  }

  /** جلب عرض يخصّ الراكب. */
  async getOne(userId: string, id: string) {
    return this.serialize(await this.owned(userId, id));
  }

  /** قائمة عروض الراكب الأحدث. */
  async listMine(userId: string, limit = 20) {
    const quotes = await this.prisma.fareQuote.findMany({
      where: { passengerId: userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return quotes.map((q) => this.serialize(q));
  }

  /**
   * محاكاة للوحة (دون حفظ) — المسار الوحيد المسموح له بمسافة/مدة يدوية.
   */
  async simulate(dto: SimulateFareQuoteDto) {
    const { result, band } = await this.price(dto, true);
    return {
      currency: result.currency,
      distanceKm: result.distanceKm,
      durationSec: result.durationSec,
      suggestedFare: band.suggested,
      minFare: band.min,
      maxFare: band.max,
      commissionPct: result.commissionPct,
      pricingSource: result.ruleUsed.source,
      pricingRuleId: result.ruleUsed.id,
      /** رسوم الخدمة/الانتظار المطبّقة فعليًا — تظهر في محاكاة اللوحة. */
      extras: result.extras,
      breakdown: result.breakdown,
    };
  }

  /** قائمة اللوحة (STAFF). */
  async adminList(query: AdminFareQuoteQueryDto) {
    const where: Prisma.FareQuoteWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.passengerId) where.passengerId = query.passengerId;
    if (query.cityId) where.cityId = query.cityId;
    const quotes = await this.prisma.fareQuote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });
    return quotes.map((q) => this.serialize(q));
  }

  /** تفاصيل عرض للوحة (STAFF). */
  async adminGet(id: string) {
    const quote = await this.prisma.fareQuote.findUnique({ where: { id } });
    if (!quote) throw new AppException("FARE_QUOTE_NOT_FOUND");
    return this.serialize(quote);
  }

  private async owned(userId: string, id: string): Promise<FareQuote> {
    const quote = await this.prisma.fareQuote.findUnique({ where: { id } });
    if (!quote || quote.passengerId !== userId) {
      throw new AppException("FARE_QUOTE_NOT_FOUND");
    }
    return quote;
  }

  private isExpired(quote: FareQuote): boolean {
    return (
      (quote.status === "QUOTED" || quote.status === "PROPOSED") &&
      quote.expiresAt.getTime() < Date.now()
    );
  }

  private async markExpired(id: string): Promise<void> {
    await this.prisma.fareQuote.update({
      where: { id },
      data: { status: "EXPIRED" },
    });
  }

  /** يحوّل السجل إلى استجابة نظيفة (Decimal → number) مع حالة انتهاء محسوبة. */
  private serialize(quote: FareQuote) {
    const effectiveStatus: FareQuoteStatus = this.isExpired(quote)
      ? "EXPIRED"
      : quote.status;
    return {
      id: quote.id,
      passengerId: quote.passengerId,
      rideClass: quote.rideClass,
      vehicleTypeId: quote.vehicleTypeId,
      cityId: quote.cityId,
      pickup: {
        lat: quote.pickupLat,
        lng: quote.pickupLng,
        address: quote.pickupAddress,
      },
      destination: {
        lat: quote.destLat,
        lng: quote.destLng,
        address: quote.destAddress,
      },
      distanceKm: quote.distanceKm,
      durationSec: quote.durationSec,
      currency: quote.currency,
      suggestedFare: Number(quote.suggestedFare),
      minFare: Number(quote.minFare),
      maxFare: Number(quote.maxFare),
      proposedFare:
        quote.proposedFare != null ? Number(quote.proposedFare) : null,
      passengerNote: quote.passengerNote,
      commissionPct: quote.commissionPct,
      pricingSource: quote.pricingSource,
      pricingRuleId: quote.pricingRuleId,
      status: effectiveStatus,
      expiresAt: quote.expiresAt.toISOString(),
      proposedAt: quote.proposedAt ? quote.proposedAt.toISOString() : null,
      tripId: quote.tripId,
      createdAt: quote.createdAt.toISOString(),
      updatedAt: quote.updatedAt.toISOString(),
    };
  }
}
