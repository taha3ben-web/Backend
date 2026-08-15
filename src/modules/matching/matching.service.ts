import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CouponFundingSource, Prisma, RideClass, Trip } from "@prisma/client";
import type Redis from "ioredis";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { RedisService } from "../redis/redis.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationDispatcher } from "../notifications/notification-dispatcher.service";
import { PricingService } from "./pricing.service";
import { CouponsService } from "../coupons/coupons.service";
import { RequestRideDto } from "./dto/matching.dto";
import { MatchingEngineService } from "./engine/matching-engine.service";
import { driverOfferKey } from "./matching-lock.util";
import { CityScalingService } from "../city-scaling/city-scaling.service";
import { TracerService } from "../../common/observability/tracer.service";
import { AppException } from "../../common/api/app.exception";
import { loadPassengerSummary } from "../../common/passenger-summary";
import { StorageService } from "../storage/storage.service";
import { maskPhone } from "../calls/call-masking.adapter";
import { splitCouponFunding } from "../trips/settlement.util";
import { round2 } from "../../common/money.util";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";
import { TripsService } from "../trips/trips.service";
import { PassengerCancellationRiskService } from "../trips/passenger-cancellation-risk.service";
import { ProfileLevelsService } from "../profile-levels/profile-levels.service";

interface PendingOffer {
  resolve: (accepted: boolean) => void;
  timer: NodeJS.Timeout;
}

// إعدادات المطابقة
const SEARCH_RADIUS_KM = 5;
const MAX_CANDIDATES = 10;
const OFFER_TIMEOUT_MS = 20_000; // مهلة ظهور الطلب وقبوله لكل سائق
const OFFER_BATCH_SIZE = Math.min(
  Math.max(Number(process.env.MATCHING_OFFER_BATCH_SIZE) || 5, 2),
  MAX_CANDIDATES,
);

// قناة Redis Pub/Sub لإيصال رد السائق (قبول/رفض) عبر كل نسخ الخادم.
// حرجة للتوسّع الأفقي: عند تشغيل عدة نسخ خلف Load Balancer قد يتصل
// السائق بنسخة مختلفة عن النسخة التي تُشغّل حلقة المطابقة؛ بدون هذا
// الجسر لا يصل رد السائق أبدًا فتنتهي مهلة كل عرض (الإرسال معطّل فعليًا).
const CH_OFFER_RESPONSE = "matching:offer_response";

// حدّ أمان لاسترداد الرحلات العالقة في SEARCHING إذا تعطّلت النسخة
// التي كانت تُشغّل حلقة المطابقة (فشل تعافٍ). أكبر من أقصى زمن بحث
// نظري (radiusان × 10 مرشحين × 20s ≈ 7 دقائق).
const STUCK_SEARCH_MS = 10 * 60 * 1000;

/**
 * محرك المطابقة:
 * 1. الراكب يطلب رحلة ← تقدير أجرة + إنشاء Trip (SEARCHING)
 * 2. إيجاد أقرب السائقين المتاحين عبر Redis GEO
 * 3. عرض الرحلة على دفعة سائقين مؤهلين في الوقت نفسه
 * 4. أول من يقبل يفوز ← تعيين السائق (ACCEPTED)
 * 5. إن رفض الجميع / انتهت المهلة ← لا يوجد سائق
 */
@Injectable()
export class MatchingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingService.name);
  // عروض معلّقة بانتظار رد السائق — المفتاح هو `${tripId}:${driverUserId}`.
  // محلية لكل نسخة (تحمل الوعد Promise)؛ يُحلّها رد يصل عبر Pub/Sub.
  private readonly pending = new Map<string, PendingOffer>();
  // رحلات أُلغيت أثناء البحث (تسريع كسر الحلقة على النسخة نفسها).
  // الإلغاء عبر النسخ يُلتقط أيضًا عبر إعادة فحص حالة الرحلة في القاعدة.
  private readonly cancelled = new Set<string>();
  // اتصال اشتراك منفصل (ioredis في وضع الاشتراك لا ينفّذ أوامر عادية).
  private sub: Redis | null = null;

  constructor(
    // دائرية حقيقية (انظر MatchingModule): تُحلّ بـ forwardRef في الطرفين.
    @Inject(forwardRef(() => TripsService))
    private readonly trips: TripsService,
    private readonly cronLock: DistributedLockService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pricing: PricingService,
    private readonly coupons: CouponsService,
    private readonly engine: MatchingEngineService,
    private readonly cityScaling: CityScalingService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    @Inject(forwardRef(() => NotificationDispatcher))
    private readonly notifications: NotificationDispatcher,
    private readonly storage: StorageService,
    // D-4: تسجيل إلغاءات الراكب والتحدير/التجميد (بلا أي أثر مالي).
    private readonly cancellationRisk: PassengerCancellationRiskService,
    // المرحلة 11: مستوى السائق وإطاره من نفس نقطة الحساب.
    // forwardRef مطلوب هنا أيضًا بسبب الحلقة:
    // MatchingModule → ProfileLevelsModule → RealtimeModule → MatchingModule.
    @Inject(forwardRef(() => ProfileLevelsService))
    private readonly profileLevels: ProfileLevelsService,
    @Optional() private readonly tracer?: TracerService,
  ) {}

  private withTrace<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer
      ? this.tracer.withSpan(name, async () => fn(), attributes)
      : fn();
  }

  async onModuleInit(): Promise<void> {
    try {
      this.sub = this.redis.duplicate();
      await this.sub.subscribe(CH_OFFER_RESPONSE);
      this.sub.on("message", (channel: string, raw: string) => {
        if (channel === CH_OFFER_RESPONSE) this.onOfferResponse(raw);
      });
      this.sub.on("error", (err) =>
        this.logger.error(`matching sub error: ${err?.message ?? err}`),
      );
    } catch (err) {
      this.logger.error(`تعذّر تفعيل جسر المطابقة عبر Redis: ${err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // تنظيف: أوقف كل مؤقتات العروض وحُلّها كرفض حتى لا تبقى وعود معلّقة،
    // ثم أغلق اتصال الاشتراك (منع تسرّب الذاكرة/الاتصالات عند الإيقاف).
    for (const [, offer] of this.pending) {
      clearTimeout(offer.timer);
      offer.resolve(false);
    }
    this.pending.clear();
    this.cancelled.clear();
    if (this.sub) {
      try {
        await this.sub.quit();
      } catch {
        this.sub.disconnect();
      }
      this.sub = null;
    }
  }

  /** الراكب يطلب رحلة: ينشئ Trip ثم يبدأ البحث في الخلفية */
  async requestRide(passengerId: string, dto: RequestRideDto): Promise<Trip> {
    return this.withTrace(
      "matching.request_ride",
      {
        passengerId,
        cityId: dto.cityId ?? null,
        rideClass: dto.rideClass ?? "ECONOMY",
      },
      async () => {
        // منع رحلتين نشطتين للراكب نفسه
        const active = await this.prisma.trip.findFirst({
          where: {
            passengerId,
            status: {
              in: ["SEARCHING", "ACCEPTED", "ARRIVING", "IN_PROGRESS"],
            },
          },
        });
        if (active) {
          throw new AppException("ACTIVE_TRIP_EXISTS", {
            details: { tripId: active.id },
          });
        }

        // D-4 — الحساب المجمّد/المحطور لا يستطيع طلب رحلة جديدة.
        // فك التجميد من لوحة التحكم حصرًا (PATCH /passengers/:id/activate).
        const passenger = await this.prisma.user.findUnique({
          where: { id: passengerId },
          select: { status: true },
        });
        if (passenger && passenger.status !== "ACTIVE") {
          throw new AppException("ACCOUNT_INACTIVE", {
            details: { status: passenger.status },
          });
        }

        const rideClass: RideClass = dto.rideClass ?? "ECONOMY";
        if (dto.cityId) {
          const capacity = await this.cityScaling.evaluateAcceptance(
            dto.cityId,
            rideClass,
          );
          if (!capacity.accept) {
            throw new AppException("CITY_CAPACITY_REJECTED", {
              details: {
                cityId: dto.cityId,
                rideClass,
                reason: capacity.reason,
              },
            });
          }
        }
        const vehicleTypeId = dto.vehicleTypeId ?? null;
        const quote = await this.pricing.quote(
          dto.pickupLat,
          dto.pickupLng,
          dto.destLat,
          dto.destLng,
          {
            rideClass,
            cityId: dto.cityId,
            vehicleTypeId: vehicleTypeId ?? undefined,
            subjectId: passengerId,
          },
        );

        // تطبيق الكوبون (اختياري) — تحقّق وحساب فقط، بلا أثر جانبي هنا.
        // الحجز الفعلي يجري داخل معاملة إنشاء الرحلة أدناه.
        let fare = quote.fare;
        let couponId: string | null = null;
        let discountAmount: number | null = null;
        let couponFundingSource: CouponFundingSource | null = null;
        let couponPlatformShare: number | null = null;
        if (dto.couponCode) {
          const applied = await this.coupons.validateAndCompute(
            dto.couponCode,
            passengerId,
            quote.fare,
            // الفئة والمدينة من حساب الخادم، كي تُفرض تقييدات الكوبون بصدق.
            { rideClass, cityId: dto.cityId },
          );
          fare = applied.finalFare;
          couponId = applied.coupon.id;
          discountAmount = applied.discount;
          couponFundingSource = applied.fundingSource;
          couponPlatformShare = applied.platformShare;
        }

        // تحقّق من كفاية رصيد المحفظة وقت الطلب عند اختيار الدفع بالمحفظة،
        // ونرفض الطلب برسالة واضحة قبل إنشاء الرحلة عند عدم الكفاية.
        if (dto.paymentMethod === "WALLET") {
          const walletAccount = await this.prisma.financialAccount.findUnique({
            where: {
              code: `USER:${passengerId}:${quote.currency}:AVAILABLE`,
            },
            select: { balanceCache: true },
          });
          const available = Number(walletAccount?.balanceCache ?? 0);
          if (available + 1e-9 < fare) {
            throw new AppException("INSUFFICIENT_BALANCE", {
              details: {
                required: fare,
                available,
                currency: quote.currency,
              },
            });
          }
        }

        // إنشاء الرحلة وحجز الكوبون في معاملة واحدة: إمّا أن يتمّا معًا أو لا.
        // سابقًا كان الحجز يسبق فحص الرصيد وإنشاء الرحلة، فيُستهلك استخدام
        // الكوبون حتى حين يفشل الطلب، بلا أي مسار لإرجاعه لأن الرحلة لم تُنشأ أصلًا.
        const trip = await this.prisma.$transaction(async (client) => {
          const created = await client.trip.create({
            data: {
              passengerId,
              status: "SEARCHING",
              rideClass,
              vehicleTypeId,
              pickupLat: dto.pickupLat,
              pickupLng: dto.pickupLng,
              pickupAddress: dto.pickupAddress,
              destLat: dto.destLat,
              destLng: dto.destLng,
              destAddress: dto.destAddress,
              // محطات التوقّف الوسيطة تُحفظ بترتيبها كي يراها السائق في مساره.
              ...(dto.stops?.length
                ? {
                    stops: {
                      create: dto.stops.map((stop, index) => ({
                        seq: index + 1,
                        lat: stop.lat,
                        lng: stop.lng,
                        address: stop.address,
                      })),
                    },
                  }
                : {}),
              distanceKm: quote.distanceKm,
              durationSec: quote.durationSec,
              // مسار الطرق الحقيقي يُحفظ مرة واحدة ليرسمه التطبيق دون إعادة حساب.
              routePolyline: quote.route?.polyline ?? null,
              routeProvider: quote.route?.provider ?? null,
              fare,
              commissionPct: quote.commissionPct,
              currency: quote.currency,
              paymentMethod: dto.paymentMethod ?? undefined,
              cityId: dto.cityId,
              couponId,
              discountAmount,
              couponFundingSource,
              couponPlatformShare,
              events: {
                create: {
                  type: "trip:requested",
                  actor: "PASSENGER",
                  meta: {
                    pricingExperimentVariant: quote.experimentVariant,
                    countryCode: quote.breakdown.countryCode,
                    taxNet: quote.breakdown.taxNet,
                    taxAmount: quote.breakdown.taxAmount,
                    taxGross: quote.breakdown.taxGross,
                  },
                },
              },
            },
          });
          if (couponId) {
            await this.coupons.redeem(
              couponId,
              passengerId,
              created.id,
              client,
            );
          }
          return created;
        });

        // بدء البحث دون حجز الطلب (fire-and-forget)
        void this.runMatching(trip.id).catch((err) =>
          this.logger.error(`matching failed for ${trip.id}: ${err}`),
        );

        return trip;
      },
    );
  }

  /** حلقة البحث: دفعات متزامنة، وأول تعيين ذري ناجح يفوز. */
  private async runMatching(tripId: string): Promise<void> {
    return this.withTrace("matching.run", { tripId }, async () => {
      try {
        const trip = await this.prisma.trip.findUnique({
          where: { id: tripId },
        });
        if (!trip || trip.status !== "SEARCHING") return;

        const tried = new Set<string>();

        // محاولتان لتوسيع نطاق البحث
        for (const radius of [SEARCH_RADIUS_KM, SEARCH_RADIUS_KM * 2]) {
          if (this.cancelled.has(tripId)) break;

          const candidates = await this.findCandidates(
            trip.pickupLat,
            trip.pickupLng,
            radius,
            tried,
            trip.rideClass,
            trip.vehicleTypeId,
          );

          for (
            let offset = 0;
            offset < candidates.length;
            offset += OFFER_BATCH_SIZE
          ) {
            if (this.cancelled.has(tripId)) break;
            const batch = candidates.slice(offset, offset + OFFER_BATCH_SIZE);
            batch.forEach((driverUserId) => tried.add(driverUserId));

            // تأكد أن الرحلة ما زالت قيد البحث (يلتقط الإلغاء عبر النسخ أيضًا).
            const fresh = await this.prisma.trip.findUnique({
              where: { id: tripId },
              select: { status: true },
            });
            if (!fresh || fresh.status !== "SEARCHING") return;

            const assigned = await this.offerToBatch(trip, batch);
            if (assigned) return;
          }
        }

        // لا يوجد سائق متاح
        const current = await this.prisma.trip.findUnique({
          where: { id: tripId },
          select: { status: true, passengerId: true },
        });
        if (current && current.status === "SEARCHING") {
          await this.releaseCoupon(tripId);
          await this.prisma.trip.update({
            where: { id: tripId },
            data: {
              status: "CANCELLED",
              cancelReason: "لا يوجد سائق متاح",
              cancelledBy: "SYSTEM",
              events: { create: { type: "trip:no_drivers", actor: "SYSTEM" } },
            },
          });
          this.realtime.emitToUser(current.passengerId, "ride:no_drivers", {
            tripId,
          });
          this.realtime.emitTripStatus(tripId, "CANCELLED");
        }
      } finally {
        // نظّف علامة الإلغاء المحلية دائمًا (منع تسرّب ذاكرة تدريجي).
        this.cancelled.delete(tripId);
      }
    });
  }

  /**
   * يعرض الطلب على دفعة كاملة بالتزامن. قد يضغط أكثر من سائق «قبول»،
   * لكن assignDriver تقفل السائق وتتحقق من SEARCHING داخل معاملة؛ لذلك
   * أول معاملة ناجحة فقط تفوز وتُغلق البطاقات عند بقية السائقين.
   */
  private async offerToBatch(
    trip: Trip,
    driverUserIds: string[],
  ): Promise<boolean> {
    const reserved = (
      await Promise.all(
        driverUserIds.map(async (driverUserId) => {
          try {
            const acquired = await this.redis.acquireLock(
              driverOfferKey(driverUserId),
              trip.id,
              OFFER_TIMEOUT_MS,
            );
            return acquired ? driverUserId : null;
          } catch {
            return driverUserId; // fail-open؛ التعيين الذري يبقى الضمان.
          }
        }),
      )
    ).filter((id): id is string => id !== null);

    if (!reserved.length) return false;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let remaining = reserved.length;

      const complete = async (driverUserId: string, accepted: boolean) => {
        if (settled) {
          await this.redis
            .releaseLock(driverOfferKey(driverUserId), trip.id)
            .catch(() => undefined);
          return;
        }

        const assigned = accepted
          ? await this.assignDriver(trip.id, driverUserId)
          : false;
        await this.redis
          .releaseLock(driverOfferKey(driverUserId), trip.id)
          .catch(() => undefined);

        if (assigned && !settled) {
          settled = true;
          this.closeCompetingOffers(trip.id, driverUserId, reserved);
          resolve(true);
          return;
        }

        remaining -= 1;
        if (!settled && remaining === 0) resolve(false);
      };

      for (const driverUserId of reserved) {
        void this.offerToDriver(trip, driverUserId)
          .then((accepted) => complete(driverUserId, accepted))
          .catch(() => complete(driverUserId, false));
      }
    });
  }

  /** يغلق عروض المنافسين فور اختيار السائق الفائز. */
  private closeCompetingOffers(
    tripId: string,
    winnerUserId: string,
    driverUserIds: string[],
  ): void {
    for (const driverUserId of driverUserIds) {
      if (driverUserId === winnerUserId) continue;
      const closed = this.resolvePending(`${tripId}:${driverUserId}`, false);
      if (closed) {
        this.realtime.emitToUser(driverUserId, "ride:offer_expired", {
          tripId,
          reason: "accepted_by_another_driver",
        });
      }
    }
  }

  /**
   * إيجاد مرشحين متاحين (APPROVED + ONLINE + بلا رحلة حالية).
   * يفوّض الاختيار والترتيب إلى محرك المطابقة المستقل (MatchingEngineService)
   * الذي يطبّق الاستراتيجية الحالية (الافتراضي: أقرب سائق). حلقة العروض تبقى هنا.
   */
  private findCandidates(
    lat: number,
    lng: number,
    radiusKm: number,
    exclude: Set<string>,
    rideClass: RideClass,
    vehicleTypeId?: string | null,
  ): Promise<string[]> {
    return this.engine.selectCandidates(
      {
        pickupLat: lat,
        pickupLng: lng,
        radiusKm,
        rideClass,
        vehicleTypeId,
      },
      exclude,
      MAX_CANDIDATES,
    );
  }

  /**
   * صافي السائق المتوقع من الرحلة — يُحسب في الخادم ويُرسل مع العرض.
   *
   * المرحلة 7: كان DriverApp يحسب الصافي محليًا بـ fare - fare*pct/100،
   * وهذا يخالف التسوية الفعلية في settleTrip التي تحسب العمولة على
   * الأجرة قبل خصم الكوبون (grossFare = riderPays + discount) وتخصم حصة
   * السائق من تمويل الكوبون. نستخدم هنا نفس دالة التوزيع المستخدمة
   * في التسوية (splitCouponFunding) حتى لا يرى السائق رقمًا يختلف عن أرباحه.
   */
  private expectedDriverNet(trip: Trip): number {
    const riderPays = round2(Number(trip.fare ?? 0));
    const discount = round2(Math.max(Number(trip.discountAmount ?? 0), 0));
    const grossFare = round2(riderPays + discount);
    const commissionPct = Number(trip.commissionPct ?? 0);
    const commissionGross = round2((grossFare * commissionPct) / 100);
    const { driverFunded } = splitCouponFunding(
      discount,
      trip.couponFundingSource,
      trip.couponPlatformShare == null
        ? undefined
        : Number(trip.couponPlatformShare),
    );
    return round2(grossFare - commissionGross - driverFunded);
  }

  /** إرسال عرض للسائق وانتظار ردّه ضمن المهلة */
  private async offerToDriver(
    trip: Trip,
    driverUserId: string,
  ): Promise<boolean> {
    const key = `${trip.id}:${driverUserId}`;
    const passenger = await loadPassengerSummary(
      this.prisma,
      trip.passengerId,
      this.storage,
    );

    this.realtime.emitToUser(driverUserId, "ride:offer", {
      tripId: trip.id,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      pickupAddress: trip.pickupAddress,
      destLat: trip.destLat,
      destLng: trip.destLng,
      destAddress: trip.destAddress,
      rideClass: trip.rideClass,
      vehicleTypeId: trip.vehicleTypeId,
      fare: trip.fare,
      commissionPct: trip.commissionPct,
      // صافي السائق محسوبًا في الخادم بنفس منطق التسوية (المرحلة 7).
      driverNet: this.expectedDriverNet(trip),
      currency: trip.currency,
      distanceKm: trip.distanceKm,
      expiresInMs: OFFER_TIMEOUT_MS,
      passenger,
    });

    // قناة احتياطية عبر Push: الـ socket هو المسار الأساسي وهو ما يعرض
    // الطلب فورًا وقت التطبيق مفتوح، لكن نظام التشغيل (خصوصًا MIUI) يعلّق
    // اتصال الـ socket في الخلفية بلا ضمان. لا ننتظر النتيجة ولا نكسر تدفّق
    // العرض لو فشل الإرسال — نفس نمط نشر Redis أسفله (fire-and-forget).
    void this.notifications
      .dispatch({
        channel: "PUSH",
        userIds: [driverUserId],
        title: "طلب رحلة جديد",
        body: trip.pickupAddress
          ? `من ${trip.pickupAddress}`
          : "لديك عرض رحلة بانتظار ردّك",
        data: { tripId: trip.id, type: "ride_offer" },
      })
      .catch(() => undefined);

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        this.realtime.emitToUser(driverUserId, "ride:offer_expired", {
          tripId: trip.id,
        });
        resolve(false);
      }, OFFER_TIMEOUT_MS);

      this.pending.set(key, { resolve, timer });
    });
  }

  /**
   * يستدعى من الـ Gateway عند رد السائق. قد تصل الاستجابة على نسخة
   * مختلفة عن النسخة التي تُشغّل الحلقة؛ لذا:
   *  - نحاول الحلّ محليًا (المسار السريع/النسخة الواحدة)، و
   *  - ننشر عبر Redis ليحلّها مالك العرض على أي نسخة.
   * الحلّ ذاتيّ التكرار (idempotent): بعد أول حلّ يُحذف المفتاح.
   */
  respondToOffer(
    tripId: string,
    driverUserId: string,
    accepted: boolean,
  ): void {
    const key = `${tripId}:${driverUserId}`;
    this.resolvePending(key, accepted);
    void this.redis.client
      .publish(
        CH_OFFER_RESPONSE,
        JSON.stringify({ tripId, driverUserId, accepted }),
      )
      .catch(() => undefined);
  }

  /** حلّ عرض معلّق محلي إن وُجد (آمن للاستدعاء المتكرر) */
  private resolvePending(key: string, accepted: boolean): boolean {
    const offer = this.pending.get(key);
    if (!offer) return false;
    clearTimeout(offer.timer);
    this.pending.delete(key);
    offer.resolve(accepted);
    return true;
  }

  /** معالج رسائل Pub/Sub لردود العروض القادمة من نسخ أخرى */
  private onOfferResponse(raw: string): void {
    try {
      const msg = JSON.parse(raw) as {
        tripId?: string;
        driverUserId?: string;
        accepted?: boolean;
      };
      if (
        typeof msg.tripId === "string" &&
        typeof msg.driverUserId === "string"
      ) {
        this.resolvePending(
          `${msg.tripId}:${msg.driverUserId}`,
          msg.accepted === true,
        );
      }
    } catch {
      // رسالة مشوّهة — تجاهل.
    }
  }

  /** تعيين السائق ذريًا (يفشل إن تغيرت حالة الرحلة) */
  private async assignDriver(
    tripId: string,
    driverUserId: string,
  ): Promise<boolean> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) return false;

    try {
      const updated = await this.prisma.$transaction(async (client) => {
        // 1) مطالبة ذرية بالسائق (قفل الصف): لا تنجح إلا إن كان ONLINE.
        //    تمنع إسناد السائق نفسه لرحلتين متزامنتين (double assignment).
        const claimed = await client.driver.updateMany({
          where: { id: driver.id, availability: "ONLINE" },
          data: { availability: "ON_TRIP" },
        });
        if (claimed.count === 0) return null; // السائق مأخوذ بالفعل

        // 2) تأكد أن الرحلة ما زالت قيد البحث؛ وإلا تراجع عن المعاملة
        //    (throw يُلغي المطالبة بالسائق تلقائيًا).
        const current = await client.trip.findUnique({
          where: { id: tripId },
          select: { status: true },
        });
        if (!current || current.status !== "SEARCHING") {
          throw new Error("trip-not-searching");
        }

        // 3) عيّن السائق للرحلة
        const trip = await client.trip.update({
          where: { id: tripId },
          data: {
            status: "ACCEPTED",
            driverId: driver.id,
            acceptedAt: new Date(),
            events: {
              create: { type: "trip:accepted", actor: "DRIVER" },
            },
          },
        });
        return trip;
      });

      if (!updated) return false;

      // ربط السائق بالرحلة في Redis (لتوجيه driver:moved للراكب)
      await this.redis.client.set(`driver:${driverUserId}:trip`, tripId);

      // إشعار الطرفين
      this.realtime.emitToUser(updated.passengerId, "ride:accepted", {
        tripId,
        driverId: driver.id,
        driverUserId,
      });
      this.realtime.emitToUser(driverUserId, "ride:assigned", { tripId });
      this.realtime.emitTripStatus(tripId, "ACCEPTED");

      // قناة احتياطية عبر Push للراكب — نظير ما يجري لعرض السائق في
      // offerToDriver أعلاه. الـ socket هو المسار الأساسي، لكن تطبيق الراكب
      // قد يكون في الخلفية أو مغلقًا في أهم لحظة في الرحلة (لحظة القبول).
      // fire-and-forget: الإسناد تمّ داخل المعاملة أعلاه ولا يجوز أن يُبطله
      // فشل إشعار ثانوي.
      void this.notifyPassengerAccepted(
        updated.passengerId,
        tripId,
        driver.id,
      ).catch(() => undefined);

      return true;
    } catch (err) {
      // "trip-not-searching" تسابق طبيعي (الرحلة أُسندت/أُلغيت) — ليس خطأً.
      if ((err as Error)?.message !== "trip-not-searching") {
        this.logger.error(`assignDriver failed: ${err}`);
      }
      return false;
    }
  }

  /**
   * إشعار Push للراكب عند قبول السائق — قناة موازية لحدث `ride:accepted`.
   *
   * يُضمّن اسم السائق ولوحة المركبة لأنهما وسيلة التعرّف المعتمدة في flaminGo
   * (لا يوجد رمز PIN ولا QR)، فالراكب يحتاجهما قبل فتح التطبيق أصلًا.
   * أفضل-جهد بالكامل: أي فشل هنا يُبتلع ولا يصعد إلى تدفّق الإسناد.
   */
  private async notifyPassengerAccepted(
    passengerId: string,
    tripId: string,
    driverId: string,
  ): Promise<void> {
    let body = "قبل السائق رحلتك وهو في طريقه إليك.";
    try {
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: {
          user: { select: { name: true } },
          vehicles: {
            where: { isActive: true },
            take: 1,
            select: { make: true, model: true, plate: true },
          },
        },
      });
      const vehicle = driver?.vehicles?.[0];
      const parts = [
        driver?.user?.name?.trim(),
        [vehicle?.make, vehicle?.model].filter(Boolean).join(" ").trim(),
        vehicle?.plate?.trim(),
      ].filter((part): part is string => !!part);
      if (parts.length) body = `${parts.join(" — ")} في طريقه إليك.`;
    } catch {
      // تعذّر جلب التفاصيل — النص الافتراضي كافٍ، ولا نُسقط الإشعار بسببه.
    }

    await this.notifications.dispatch({
      channel: "PUSH",
      userIds: [passengerId],
      title: "تم قبول رحلتك",
      body,
      // نفس شكل حمولة إشعارات الرحلة في TripsService.sendTripPush حتى يبقى
      // عقد الإشعارات واحدًا عبر النظام.
      data: { kind: "trip", tripId, status: "ACCEPTED", type: "ride_accepted" },
    });
  }

  /** إلغاء الطلب من الراكب أثناء البحث */
  async cancelSearch(tripId: string, passengerId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.passengerId !== passengerId) {
      throw new BadRequestException("غير مسموح");
    }
    if (trip.status !== "SEARCHING") {
      throw new BadRequestException("لا يمكن إلغاء البحث في هذه الحالة");
    }
    this.cancelled.add(tripId);
    await this.releaseCoupon(tripId);
    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: "CANCELLED",
        cancelReason: "ألغاه الراكب",
        cancelledBy: "PASSENGER",
        events: { create: { type: "trip:cancelled", actor: "PASSENGER" } },
      },
    });
    this.realtime.emitTripStatus(tripId, "CANCELLED");
  }

  /**
   * إلغاء الرحلة من طرف الراكب عبر WebSocket (ride:cancel).
   * - أثناء البحث: يوقف حلقة المطابقة ويعيد الكوبون (عبر cancelSearch).
   * - بعد القبول وقبل بدء الرحلة (ACCEPTED/ARRIVING): يلغي الرحلة،
   *   يعيد الكوبون، يحرّر السائق (إتاحته + مسح مفتاح رحلته) ويبلّغه.
   */
  async passengerCancel(
    passengerUserId: string,
    tripId: string,
    reason?: string,
  ): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        passengerId: true,
        driverId: true,
        driver: { select: { userId: true } },
      },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.passengerId !== passengerUserId) {
      throw new ForbiddenException("غير مسموح");
    }

    // أثناء البحث: أعد استخدام منطق cancelSearch (يوقف الحلقة + يعيد الكوبون)
    if (trip.status === "SEARCHING") {
      await this.cancelSearch(tripId, passengerUserId);
      // يُسجّل للمراقبة فقط: الإلغاء قبل قبول السائق لا يدخل في عدّ التجميد.
      await this.cancellationRisk.record({
        passengerId: passengerUserId,
        tripId,
        statusAtCancel: "SEARCHING",
        driverId: trip.driverId,
        reason: reason ?? null,
      });
      return;
    }

    // بعد القبول وقبل بدء الرحلة
    if (trip.status === "ACCEPTED" || trip.status === "ARRIVING") {
      const statusAtCancel = trip.status;
      await this.releaseCoupon(tripId);
      await this.prisma.trip.update({
        where: { id: tripId },
        data: {
          status: "CANCELLED",
          cancelReason: reason ?? "ألغاه الراكب",
          cancelledBy: "PASSENGER",
          events: {
            create: { type: "trip:cancelled", actor: "PASSENGER" },
          },
        },
      });
      // تحرير السائق: إتاحته من جديد ومسح ارتباطه بالرحلة في Redis
      if (trip.driverId) {
        await this.prisma.driver
          .update({
            where: { id: trip.driverId },
            data: { availability: "ONLINE" },
          })
          .catch(() => undefined);
      }
      if (trip.driver?.userId) {
        await this.redis.client
          .del(`driver:${trip.driver.userId}:trip`)
          .catch(() => undefined);

        // إلغاء *بعد* التعيين: هذه بالضبط الحالة ذات المعنى التجاري للرصد
        // (رحلة خارج المنصّة محتملة). هذا المسار لا يمرّ عبر
        // TripsService.changeStatus فلا تُفتح النافذة تلقائيًا — نفتحها صراحةً
        // بإعادة استخدام نفس الدالة (لا تكرار للمنطق).
        // أثر جانبي غير حرج: فشله لا يكسر الإلغاء.
        void this.trips
          .openPostCancellationWatch(tripId, trip.driver.userId)
          .catch(() => undefined);
      }
      // D-4 — إلغاء بعد قبول السائق: لا غرامة مالية، بل RiskEvent مع حالة
      // الرحلة وقت الإلغاء، ثم تحدير أو تجميد تلقائي عند بلوغ العتبة.
      await this.cancellationRisk.record({
        passengerId: passengerUserId,
        tripId,
        statusAtCancel: statusAtCancel,
        driverId: trip.driverId,
        reason: reason ?? null,
      });
      // بثّ التغيير لطرفَي الرحلة (السائق منضمّ لغرفة trip:{id}) وللمديرين
      this.realtime.emitTripStatus(tripId, "CANCELLED");
      return;
    }

    throw new BadRequestException("لا يمكن إلغاء الرحلة في هذه الحالة");
  }

  /**
   * D-7 — معاينة قرار الخادم قبل تأكيد الإلغاء.
   * التطبيق يعرض نص الخادم ولا يحمل أي سياسة محلية، وchargesMoney دائمًا false.
   */
  async cancelPreview(passengerUserId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { status: true, passengerId: true, driverId: true },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.passengerId !== passengerUserId) {
      throw new ForbiddenException("غير مسموح");
    }
    return this.cancellationRisk.preview(
      passengerUserId,
      trip.status,
      Boolean(trip.driverId),
    );
  }

  /** سجل رحلات الراكب (رحلاتي) */
  async passengerTrips(passengerId: string, q: PaginationDto) {
    const where: Prisma.TripWhereInput = { passengerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          driver: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      }),
      this.prisma.trip.count({ where }),
    ]);
    // إخفاء أرقام السائقين في سجلّ الرحلات.
    const masked = items.map((trip) =>
      trip.driver
        ? {
            ...trip,
            driver: {
              ...trip.driver,
              user: {
                ...trip.driver.user,
                phone: maskPhone(trip.driver.user?.phone),
              },
            },
          }
        : trip,
    );
    return { items: masked, total, page: q.page, limit: q.limit };
  }

  /** تفاصيل رحلة يملكها الراكب (أو المكلّف بها السائق) */
  async getTripForUser(tripId: string, userId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        passenger: { select: { name: true, phone: true } },
        driver: {
          include: {
            // المرحلة 11: avatarUrl مطلوب لعرض صورة السائق داخل الإطار.
            user: { select: { name: true, phone: true, avatarUrl: true } },
            vehicles: { where: { isActive: true }, take: 1 },
          },
        },
        tracking: { orderBy: { recordedAt: "desc" }, take: 1 },
        ratings: true,
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    const isOwner =
      trip.passengerId === userId || trip.driver?.userId === userId;
    if (!isOwner) {
      throw new ForbiddenException("ليست لديك صلاحية على هذه الرحلة");
    }
    // إخفاء الأرقام: الطرفان يريان رقمًا محجوبًا فقط؛ الاتصال يمرّ عبر /api/calls/connect.
    // المرحلة 11 — مستوى السائق وإطاره يرافقان بيانات الرحلة نفسها (استعلام
    // مفهرس واحد) حتى لا يحتاج الراكب إلى أي طلب إضافي لرسم الإطار.
    const driverLevel = trip.driverId
      ? await this.profileLevels.forDriver(trip.driverId)
      : null;
    return {
      ...trip,
      passenger: trip.passenger
        ? { ...trip.passenger, phone: maskPhone(trip.passenger.phone) }
        : trip.passenger,
      driver: trip.driver
        ? {
            ...trip.driver,
            avatarUrl: await this.storage.resolveStoredUrl(
              trip.driver.user?.avatarUrl ?? null,
            ),
            completedTripsCount: driverLevel?.completedTripsCount ?? 0,
            profileLevel: driverLevel?.profileLevel ?? null,
            profileFrameUrl: driverLevel?.profileFrameUrl ?? null,
            user: {
              ...trip.driver.user,
              phone: maskPhone(trip.driver.user?.phone),
            },
          }
        : trip.driver,
    };
  }

  /** إرجاع استخدام الكوبون إن كانت الرحلة تحمل واحدًا (عند الإلغاء) */
  private async releaseCoupon(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { couponId: true },
    });
    if (trip?.couponId) {
      // نمرّر tripId كي يكون الإرجاع idempotent عبر سجل الاسترداد.
      await this.coupons.release(trip.couponId, tripId);
    }
  }

  /**
   * استرداد الرحلات العالقة في SEARCHING (فشل تعافٍ): إن تعطّلت النسخة
   * التي كانت تُشغّل حلقة المطابقة تبقى الرحلة عالقة للأبد. هذه المهمّة
   * المجدولة تلغيها ذريًا (updateMany بحارس الحالة) فلا تكرار عبر النسخ.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reapStuckSearches(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:reap-stuck-searches",
      () => this.reapStuckSearchesTask(),
      240000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async reapStuckSearchesTask(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_SEARCH_MS);
    const stuck = await this.prisma.trip.findMany({
      where: { status: "SEARCHING", createdAt: { lt: cutoff } },
      select: { id: true, passengerId: true },
    });
    for (const t of stuck) {
      const claimed = await this.prisma.trip.updateMany({
        where: { id: t.id, status: "SEARCHING" },
        data: {
          status: "CANCELLED",
          cancelReason: "انتهت مهلة البحث",
          cancelledBy: "SYSTEM",
        },
      });
      if (claimed.count === 0) continue; // نسخة أخرى عالجتها
      await this.releaseCoupon(t.id).catch(() => undefined);
      await this.prisma.tripEvent
        .create({
          data: { tripId: t.id, type: "trip:search_timeout", actor: "SYSTEM" },
        })
        .catch(() => undefined);
      this.realtime.emitToUser(t.passengerId, "ride:no_drivers", {
        tripId: t.id,
      });
      this.realtime.emitTripStatus(t.id, "CANCELLED");
      this.logger.warn(`استُرِدّت رحلة عالقة في البحث: ${t.id}`);
    }
  }
}
