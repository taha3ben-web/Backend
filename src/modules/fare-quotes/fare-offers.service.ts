import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FareOffer, FareQuote, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import {
  CreateFareOfferDto,
  AdminFareOfferQueryDto,
} from "./dto/fare-offer.dto";
import { loadPassengerSummaries } from "../../common/passenger-summary";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";

type DriverBidProfile = Prisma.DriverGetPayload<{
  include: {
    vehicles: {
      select: { rideClass: true; vehicleTypeId: true };
    };
  };
}>;

/**
 * خدمة عروض السائقين المضادة (FareOffer — مزايدة inDrive).
 * السائق يقدّم عرضًا مضادًا على FareQuote مفتوح، ثم يقبل الراكب عرضًا واحدًا
 * فتُرفض بقية العروض المعلّقة ذريًّا. لا توجد حركة مالية هنا (قبل-الرحلة).
 */
@Injectable()
export class FareOffersService {
  private readonly logger = new Logger(FareOffersService.name);

  /** المدة الافتراضية لصلاحية عرض السائق (نافذة مزايدة قصيرة كـ inDrive). */
  private static readonly OFFER_TTL_MS = 120_000;

  /** يحسب لحظة انتهاء صلاحية العرض دون تجاوز صلاحية عرض السعر نفسه. */
  private computeOfferExpiry(quote: FareQuote): Date {
    const ttl = Date.now() + FareOffersService.OFFER_TTL_MS;
    return new Date(Math.min(ttl, quote.expiresAt.getTime()));
  }

  constructor(
    private readonly cronLock: DistributedLockService,
    private readonly prisma: PrismaService,
    // تبعية دائرية عبر RealtimeGateway — نؤجّل الحقن بـ forwardRef.
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** يحلّ userId لسائق واحد (لغرفة user:{id} في الـ WebSocket). */
  private async resolveDriverUserId(driverId: string): Promise<string | null> {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    return d?.userId ?? null;
  }

  /** يحلّ userIds لمجموعة سائقين دفعة واحدة (Driver.id → User.id). */
  private async resolveDriverUserIds(
    driverIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(driverIds)];
    if (!unique.length) return new Map();
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: unique } },
      select: { id: true, userId: true },
    });
    return new Map(drivers.map((d) => [d.id, d.userId]));
  }

  /** بثّ حدث لمستخدم بأفضل-جهد؛ فشل الـ WebSocket لا يُفشل عملية REST. */
  private notify(userId: string | null, event: string, payload: unknown): void {
    if (!userId) return;
    try {
      this.realtime.emitToUser(userId, event, payload);
    } catch (err) {
      this.logger.warn(
        `realtime emit "${event}" failed: ${(err as Error).message}`,
      );
    }
  }

  /** إشعار Push بأفضل-جهد؛ يصل حتى والتطبيق مغلق (لا يُفشل عملية REST). */
  private notifyPush(
    userId: string | null,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): void {
    if (!userId) return;
    this.notifications
      .notifyUser(userId, title, body, "PUSH", data)
      .catch((err) =>
        this.logger.warn(`push "${title}" failed: ${(err as Error).message}`),
      );
  }

  /** يحلّ سجل السائق من userId (Driver.id متوافق مع Trip.driverId). */
  private async requireDriver(userId: string): Promise<DriverBidProfile> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        vehicles: {
          where: { isActive: true, verificationStatus: "APPROVED" },
          select: { rideClass: true, vehicleTypeId: true },
        },
      },
    });
    if (!driver) throw new AppException("DRIVER_NOT_FOUND");
    return driver;
  }

  private assertDriverCanBid(driver: DriverBidProfile): void {
    if (driver.status !== "APPROVED") {
      throw new AppException("DRIVER_NOT_APPROVED");
    }
    if (driver.availability !== "ONLINE") {
      throw new AppException("FARE_OFFER_DRIVER_UNAVAILABLE");
    }
    if (!driver.vehicles.length) {
      throw new AppException("DRIVER_VERIFIED_VEHICLE_REQUIRED");
    }
  }

  private driverMatchesQuote(
    driver: DriverBidProfile,
    quote: FareQuote,
  ): boolean {
    if (quote.cityId && quote.cityId !== driver.cityId) return false;
    return driver.vehicles.some(
      (vehicle) =>
        vehicle.rideClass === quote.rideClass &&
        (!quote.vehicleTypeId || vehicle.vehicleTypeId === quote.vehicleTypeId),
    );
  }

  /** السائق: طلبات تفاوض مفتوحة تناسب المدينة والمركبة المعتمدتين. */
  async listDriverOpportunities(userId: string, limit = 20) {
    const driver = await this.requireDriver(userId);
    this.assertDriverCanBid(driver);
    const quotes = await this.prisma.fareQuote.findMany({
      where: {
        status: "PROPOSED",
        expiresAt: { gt: new Date() },
        ...(driver.cityId
          ? { OR: [{ cityId: null }, { cityId: driver.cityId }] }
          : { cityId: null }),
      },
      orderBy: { proposedAt: "asc" },
      take: Math.min(Math.max(limit * 3, 20), 100),
    });
    const matching = quotes
      .filter((quote) => this.driverMatchesQuote(driver, quote))
      .slice(0, Math.min(Math.max(limit, 1), 50));
    const mine = matching.length
      ? await this.prisma.fareOffer.findMany({
          where: {
            driverId: driver.id,
            fareQuoteId: { in: matching.map((quote) => quote.id) },
            status: "PENDING",
          },
        })
      : [];
    const mineByQuote = new Map(
      mine.map((offer) => [offer.fareQuoteId, offer]),
    );
    const passengerById = await loadPassengerSummaries(
      this.prisma,
      matching.map((quote) => quote.passengerId),
      this.storage,
    );
    return matching.map((quote) => ({
      id: quote.id,
      rideClass: quote.rideClass,
      vehicleTypeId: quote.vehicleTypeId,
      cityId: quote.cityId,
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      pickupAddress: quote.pickupAddress,
      destLat: quote.destLat,
      destLng: quote.destLng,
      destAddress: quote.destAddress,
      distanceKm: quote.distanceKm,
      durationSec: quote.durationSec,
      currency: quote.currency,
      suggestedFare: Number(quote.suggestedFare),
      proposedFare: quote.proposedFare ? Number(quote.proposedFare) : null,
      passengerNote: quote.passengerNote,
      minFare: Number(quote.minFare),
      maxFare: Number(quote.maxFare),
      commissionPct: quote.commissionPct,
      expiresAt: quote.expiresAt.toISOString(),
      passenger: passengerById.get(quote.passengerId) ?? null,
      myOffer: mineByQuote.has(quote.id)
        ? this.serialize(mineByQuote.get(quote.id)!)
        : null,
    }));
  }

  /** يحمّل عرض سعر يخصّ الراكب أو يرمي خطأ عدم وجود. */
  private async requireQuoteOwned(
    passengerUserId: string,
    quoteId: string,
  ): Promise<FareQuote> {
    const quote = await this.prisma.fareQuote.findUnique({
      where: { id: quoteId },
    });
    if (!quote || quote.passengerId !== passengerUserId) {
      throw new AppException("FARE_QUOTE_NOT_FOUND");
    }
    return quote;
  }

  private isQuoteOpen(quote: FareQuote): boolean {
    return (
      (quote.status === "QUOTED" || quote.status === "PROPOSED") &&
      quote.expiresAt.getTime() >= Date.now()
    );
  }

  /** يتأكد أن العرض مفتوح للمزايدة وإلا يرمي خطأً مناسبًا. */
  private assertQuoteOpen(quote: FareQuote): void {
    if (
      (quote.status === "QUOTED" || quote.status === "PROPOSED") &&
      quote.expiresAt.getTime() < Date.now()
    ) {
      throw new AppException("FARE_QUOTE_EXPIRED");
    }
    if (!this.isQuoteOpen(quote)) {
      throw new AppException("FARE_QUOTE_INVALID_STATE");
    }
  }

  /** السائق: تقديم عرض مضاد (أو تحديث عرضه المعلّق الحالي). */
  async createOffer(userId: string, dto: CreateFareOfferDto) {
    const driver = await this.requireDriver(userId);
    this.assertDriverCanBid(driver);
    const quote = await this.prisma.fareQuote.findUnique({
      where: { id: dto.fareQuoteId },
    });
    if (!quote) throw new AppException("FARE_QUOTE_NOT_FOUND");
    this.assertQuoteOpen(quote);
    if (!this.driverMatchesQuote(driver, quote)) {
      throw new AppException("FARE_QUOTE_NOT_ELIGIBLE");
    }

    const roundedAmount = Math.round(dto.amount * 100) / 100;
    const min = Number(quote.minFare);
    const max = Number(quote.maxFare);
    if (roundedAmount < min || roundedAmount > max) {
      throw new AppException("FARE_OFFER_OUT_OF_RANGE", {
        details: { min, max, proposed: roundedAmount },
      });
    }

    const existing = await this.prisma.fareOffer.findFirst({
      where: {
        fareQuoteId: quote.id,
        driverId: driver.id,
        status: "PENDING",
      },
    });

    const amount = new Prisma.Decimal(roundedAmount);
    if (existing) {
      const updated = await this.prisma.fareOffer.update({
        where: { id: existing.id },
        data: {
          amount,
          note: dto.note ?? null,
          etaMinutes: dto.etaMinutes ?? null,
          expiresAt: this.computeOfferExpiry(quote),
        },
      });
      const payload = this.serialize(updated);
      // بثّ فوري للراكب: عرض سائق مُحدَّث.
      this.notify(quote.passengerId, "fare:offer", {
        quoteId: quote.id,
        offer: payload,
        updated: true,
      });
      return payload;
    }

    const created = await this.prisma.fareOffer.create({
      data: {
        fareQuoteId: quote.id,
        driverId: driver.id,
        amount,
        currency: quote.currency,
        note: dto.note ?? null,
        etaMinutes: dto.etaMinutes ?? null,
        status: "PENDING",
        expiresAt: this.computeOfferExpiry(quote),
      },
    });
    const payload = this.serialize(created);
    // بثّ فوري للراكب: عرض سائق جديد.
    this.notify(quote.passengerId, "fare:offer", {
      quoteId: quote.id,
      offer: payload,
      updated: false,
    });
    this.notifyPush(
      quote.passengerId,
      "عرض سائق جديد",
      `قدّم سائق عرضًا بقيمة ${Number(amount)} ${quote.currency}.`,
      { kind: "fare_offer", quoteId: quote.id, offerId: created.id },
    );
    return payload;
  }

  /** السائق: قائمة عروضه الأحدث. */
  async listDriverOffers(userId: string, limit = 30) {
    const driver = await this.requireDriver(userId);
    const offers = await this.prisma.fareOffer.findMany({
      where: { driverId: driver.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return offers.map((o) => this.serialize(o));
  }

  /** السائق: سحب عرضه المعلّق. */
  async withdrawOffer(userId: string, offerId: string) {
    const driver = await this.requireDriver(userId);
    const offer = await this.prisma.fareOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer || offer.driverId !== driver.id) {
      throw new AppException("FARE_OFFER_NOT_FOUND");
    }
    if (offer.status !== "PENDING") {
      throw new AppException("FARE_OFFER_INVALID_STATE");
    }
    const updated = await this.prisma.fareOffer.update({
      where: { id: offer.id },
      data: { status: "WITHDRAWN", respondedAt: new Date() },
    });
    // بثّ فوري للراكب: سحب السائق لعرضه.
    const owner = await this.prisma.fareQuote.findUnique({
      where: { id: offer.fareQuoteId },
      select: { passengerId: true },
    });
    this.notify(owner?.passengerId ?? null, "fare:offer_withdrawn", {
      quoteId: offer.fareQuoteId,
      offerId: offer.id,
    });
    return this.serialize(updated);
  }

  /** الراكب: عرض العروض الواردة على عرض السعر (مع ملخّص السائق). */
  async listQuoteOffers(passengerUserId: string, quoteId: string) {
    await this.requireQuoteOwned(passengerUserId, quoteId);
    const offers = await this.prisma.fareOffer.findMany({
      where: { fareQuoteId: quoteId },
      orderBy: [{ status: "asc" }, { amount: "asc" }],
    });
    const driverIds = [...new Set(offers.map((o) => o.driverId))];
    const drivers = driverIds.length
      ? await this.prisma.driver.findMany({
          where: { id: { in: driverIds } },
          select: {
            id: true,
            rating: true,
            totalTrips: true,
            user: { select: { name: true, avatarUrl: true } },
            vehicles: {
              where: { isActive: true, verificationStatus: "APPROVED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                make: true,
                model: true,
                plate: true,
                color: true,
              },
            },
          },
        })
      : [];
    const byId = new Map(drivers.map((d) => [d.id, d]));
    return Promise.all(
      offers.map(async (o) => {
        const d = byId.get(o.driverId);
        return {
          ...this.serialize(o),
          driver: d
            ? {
                id: d.id,
                name: d.user?.name ?? null,
                // صورة السائق مخزّنة كمفتاح؛ تُحوّل لرابط عند عرض العروض للراكب.
                avatarUrl: await this.storage.resolveStoredUrl(
                  d.user?.avatarUrl ?? null,
                  STORED_MEDIA_READ_TTL_MINUTES,
                ),
                rating: d.rating,
                totalTrips: d.totalTrips,
                vehicle: d.vehicles[0] ?? null,
              }
            : null,
        };
      }),
    );
  }

  /**
   * الراكب: قبول عرض سائق — يُنشئ رحلة (Trip) بالسعر المتفَق، ويقفل عرض السعر،
   * ويرفض بقية العروض المعلّقة — كلّه ذريًّا داخل معاملة واحدة.
   * لا توجد حركة Ledger هنا: الرحلة تُنشأ بحالة ACCEPTED، والتسوية المالية
   * تبقى عند إكمال الرحلة (settleTrip) معتمدة على trip.fare + commissionPct.
   */
  async acceptOffer(passengerUserId: string, quoteId: string, offerId: string) {
    const quote = await this.requireQuoteOwned(passengerUserId, quoteId);
    this.assertQuoteOpen(quote);
    if (quote.tripId) {
      // عرض السعر حُوّل بالفعل إلى رحلة.
      throw new AppException("FARE_QUOTE_INVALID_STATE");
    }
    const offer = await this.prisma.fareOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer || offer.fareQuoteId !== quoteId) {
      throw new AppException("FARE_OFFER_NOT_FOUND");
    }
    if (offer.status !== "PENDING") {
      throw new AppException("FARE_OFFER_INVALID_STATE");
    }
    if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
      throw new AppException("FARE_OFFER_EXPIRED");
    }

    // منع رحلتين نشطتين للراكب نفسه.
    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        passengerId: quote.passengerId,
        status: { in: ["SEARCHING", "ACCEPTED", "ARRIVING", "IN_PROGRESS"] },
      },
      select: { id: true },
    });
    if (activeTrip) {
      throw new AppException("ACTIVE_TRIP_EXISTS", {
        details: { tripId: activeTrip.id },
      });
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (client) => {
      // 1) مطالبة ذريّة بالسائق (ONLINE ←→ ON_TRIP) لمنع الإسناد المزدوج.
      const claimed = await client.driver.updateMany({
        where: { id: offer.driverId, availability: "ONLINE" },
        data: { availability: "ON_TRIP" },
      });
      if (claimed.count === 0) {
        throw new AppException("FARE_OFFER_DRIVER_UNAVAILABLE");
      }

      // 2) إنشاء الرحلة بحالة ACCEPTED وبالسعر المتفَق (عرض السائق).
      const trip = await client.trip.create({
        data: {
          passengerId: quote.passengerId,
          driverId: offer.driverId,
          status: "ACCEPTED",
          rideClass: quote.rideClass,
          vehicleTypeId: quote.vehicleTypeId,
          pickupLat: quote.pickupLat,
          pickupLng: quote.pickupLng,
          pickupAddress: quote.pickupAddress,
          destLat: quote.destLat,
          destLng: quote.destLng,
          destAddress: quote.destAddress,
          distanceKm: quote.distanceKm,
          durationSec: quote.durationSec,
          fare: offer.amount,
          commissionPct: quote.commissionPct,
          currency: quote.currency,
          cityId: quote.cityId,
          events: {
            create: [
              {
                type: "trip:requested",
                actor: "PASSENGER",
                meta: { source: "fare_negotiation", fareQuoteId: quote.id },
              },
              {
                type: "trip:accepted",
                actor: "PASSENGER",
                meta: {
                  fareOfferId: offer.id,
                  driverId: offer.driverId,
                  amount: Number(offer.amount),
                },
              },
            ],
          },
        },
      });

      // 3) تثبيت حالات العروض وعرض السعر + ربط tripId.
      const accepted = await client.fareOffer.update({
        where: { id: offer.id },
        data: { status: "ACCEPTED", respondedAt: now },
      });
      // العروض المعلّقة الأخرى (ل��خطار أصحابها بالرفض بعد الالتزام).
      const siblings = await client.fareOffer.findMany({
        where: {
          fareQuoteId: quoteId,
          status: "PENDING",
          id: { not: offer.id },
        },
        select: { id: true, driverId: true },
      });
      await client.fareOffer.updateMany({
        where: {
          fareQuoteId: quoteId,
          status: "PENDING",
          id: { not: offer.id },
        },
        data: { status: "REJECTED", respondedAt: now },
      });
      await client.fareQuote.update({
        where: { id: quoteId },
        data: {
          status: "ACCEPTED",
          proposedFare: offer.amount,
          proposedAt: now,
          tripId: trip.id,
        },
      });
      return { trip, accepted, siblings };
    });

    // بثّ فوري بعد الالتزام (أفضل-جهد).
    const { trip, accepted, siblings } = result;
    const winnerUserId = await this.resolveDriverUserId(offer.driverId);
    this.notify(winnerUserId, "fare:offer_accepted", {
      quoteId,
      offerId: offer.id,
      tripId: trip.id,
      tripStatus: trip.status,
      amount: Number(offer.amount),
    });
    this.notifyPush(
      winnerUserId,
      "تم قبول عرضك",
      `قبل الراكب عرضك بقيمة ${Number(offer.amount)} ${offer.currency}. ابدأ الرحلة.`,
      {
        kind: "fare_offer_accepted",
        quoteId,
        offerId: offer.id,
        tripId: trip.id,
      },
    );
    this.notify(quote.passengerId, "fare:quote_accepted", {
      quoteId,
      offerId: offer.id,
      tripId: trip.id,
      tripStatus: trip.status,
    });
    if (siblings.length) {
      const userIds = await this.resolveDriverUserIds(
        siblings.map((s) => s.driverId),
      );
      for (const s of siblings) {
        const uid = userIds.get(s.driverId) ?? null;
        this.notify(uid, "fare:offer_rejected", {
          quoteId,
          offerId: s.id,
          reason: "another_offer_accepted",
        });
        this.notifyPush(
          uid,
          "لم يُقبل عرضك",
          "اختار الراكب عرض سائق آخر لهذه الرحلة.",
          { kind: "fare_offer_rejected", quoteId, offerId: s.id },
        );
      }
    }
    try {
      this.realtime.emitTripStatus(trip.id, trip.status);
    } catch (err) {
      this.logger.warn(
        `realtime emitTripStatus failed: ${(err as Error).message}`,
      );
    }

    return {
      ...this.serialize(accepted),
      tripId: trip.id,
      tripStatus: trip.status,
    };
  }

  /** الراكب: رفض عرض سائق معيّن. */
  async rejectOffer(passengerUserId: string, quoteId: string, offerId: string) {
    await this.requireQuoteOwned(passengerUserId, quoteId);
    const offer = await this.prisma.fareOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer || offer.fareQuoteId !== quoteId) {
      throw new AppException("FARE_OFFER_NOT_FOUND");
    }
    if (offer.status !== "PENDING") {
      throw new AppException("FARE_OFFER_INVALID_STATE");
    }
    const updated = await this.prisma.fareOffer.update({
      where: { id: offer.id },
      data: { status: "REJECTED", respondedAt: new Date() },
    });
    // بثّ فوري للسائق: رفض الراكب لعرضه.
    const driverUserId = await this.resolveDriverUserId(offer.driverId);
    this.notify(driverUserId, "fare:offer_rejected", {
      quoteId,
      offerId: offer.id,
      reason: "passenger_rejected",
    });
    this.notifyPush(
      driverUserId,
      "لم يُقبل عرضك",
      "رفض الراكب عرضك لهذه الرحلة.",
      { kind: "fare_offer_rejected", quoteId, offerId: offer.id },
    );
    return this.serialize(updated);
  }

  /** اللوحة (STAFF): قائمة العروض مع مرشّحات. */
  async adminList(query: AdminFareOfferQueryDto) {
    const where: Prisma.FareOfferWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.fareQuoteId) where.fareQuoteId = query.fareQuoteId;
    if (query.driverId) where.driverId = query.driverId;
    const offers = await this.prisma.fareOffer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(query.limit ?? 50, 1), 200),
    });
    return offers.map((o) => this.serialize(o));
  }

  /** اللوحة (STAFF): تفاصيل عرض. */
  async adminGet(id: string) {
    const offer = await this.prisma.fareOffer.findUnique({ where: { id } });
    if (!offer) throw new AppException("FARE_OFFER_NOT_FOUND");
    return this.serialize(offer);
  }

  /**
   * مهمة دورية: تُنهي صلاحية العروض المعلّقة التي تجاوزت expiresAt وتبثّ
   * الحدث للطرفين (الراكب والسائق). أفضل-جهد: فشل البثّ لا يُفشل التحديث.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async expirePendingOffers(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:fare-offers-expire",
      () => this.expirePendingOffersTask(),
      25000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async expirePendingOffersTask(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.fareOffer.findMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
      select: { id: true, fareQuoteId: true, driverId: true },
    });
    if (!expired.length) return;

    const ids = expired.map((o) => o.id);
    const res = await this.prisma.fareOffer.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "EXPIRED", respondedAt: now },
    });
    if (!res.count) return;

    // بثّ فوري للطرفين (أفضل-جهد).
    const quoteIds = [...new Set(expired.map((o) => o.fareQuoteId))];
    const quotes = await this.prisma.fareQuote.findMany({
      where: { id: { in: quoteIds } },
      select: { id: true, passengerId: true },
    });
    const passengerByQuote = new Map(quotes.map((q) => [q.id, q.passengerId]));
    const driverUserIds = await this.resolveDriverUserIds(
      expired.map((o) => o.driverId),
    );
    for (const o of expired) {
      const evt = { quoteId: o.fareQuoteId, offerId: o.id };
      this.notify(
        passengerByQuote.get(o.fareQuoteId) ?? null,
        "fare:offer_expired",
        evt,
      );
      const driverUid = driverUserIds.get(o.driverId) ?? null;
      this.notify(driverUid, "fare:offer_expired", evt);
      this.notifyPush(
        driverUid,
        "انتهت صلاحية عرضك",
        "انتهت مهلة عرضك قبل أن يقبله الراكب.",
        { kind: "fare_offer_expired", quoteId: o.fareQuoteId, offerId: o.id },
      );
    }
    this.logger.log(`expired ${res.count} pending fare offer(s)`);
  }

  private serialize(offer: FareOffer) {
    return {
      id: offer.id,
      fareQuoteId: offer.fareQuoteId,
      driverId: offer.driverId,
      amount: Number(offer.amount),
      currency: offer.currency,
      note: offer.note,
      etaMinutes: offer.etaMinutes,
      status: offer.status,
      expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
      respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    };
  }
}
