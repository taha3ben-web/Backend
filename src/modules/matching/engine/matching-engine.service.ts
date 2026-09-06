import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { RoutingService } from "../../geo/routing.service";
import {
  DriverCandidate,
  MatchingContext,
  MatchingStrategy,
} from "./matching-strategy";
import { FastestEtaStrategy } from "./nearest-driver.strategy";
import { driverOfferKey, filterUnreserved } from "../matching-lock.util";
import {
  bumpCounter,
  observeHistogram,
  safeMetric,
} from "../../../common/observability/runtime-metrics";

/**
 * أقصى عدد مرشحين يُحسب لهم ETA حقيقي.
 * حدّ متعمّد: حساب ETA لـ 200 سائقًا في مدينة مزدحمة يبطئ إسناد الرحلة بلا فائدة،
 * فالترتيب النهائي لا يتجاوز عشرة عروض.
 */
const ETA_CANDIDATE_LIMIT = 25;

/**
 * محرك المطابقة المستقل (Matching Engine).
 * مستقل تمامًا عن الـ Controller وعن حلقة العروض: مهمته اختيار
 * المرشّحين المؤهلين وترتيبهم وفق استراتيجية قابلة للتبديل.
 *
 * الافتراضي الآن: **أسرع وصولًا (FASTEST_ETA)** باعتماد محرك التوجيه،
 * مع ارتداد تلقائي إلى ترتيب القرب الجغرافي عند تعطّل التوجيه.
 */
@Injectable()
export class MatchingEngineService {
  private readonly logger = new Logger(MatchingEngineService.name);
  private strategy: MatchingStrategy = new FastestEtaStrategy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly routing?: RoutingService,
  ) {}

  /** تبديل استراتيجية المطابقة (أقرب/أسرع/أفضل/مزاد/AI...). */
  setStrategy(strategy: MatchingStrategy): void {
    this.strategy = strategy;
    this.logger.log(`matching strategy set to: ${strategy.name}`);
  }

  getStrategyName(): string {
    return this.strategy.name;
  }

  /**
   * اختيار المرشّحين المتاحين (APPROVED + ONLINE + غير مشغولين)
   * مرتّبين حسب الاستراتيجية الحالية. لا يُدير العروض — ذلك من مسؤولية حلقة المطابقة.
   *
   * الرصد (PR A): هذه الدالة غلاف قياس فقط؛ الخوارزمية كاملة في
   * `selectCandidatesInternal` بلا أي تغيير: لا نطاق، ولا COUNT، ولا حدود جديدة،
   * ولا مساس بالأقفال أو الترتيب. أي خطأ يُعاد رفعه كما هو.
   */
  async selectCandidates(
    ctx: MatchingContext,
    exclude: Set<string>,
    max: number,
  ): Promise<string[]> {
    const startedAt = Date.now();
    safeMetric(() => bumpCounter("matching_requests_total"));
    try {
      const outcome = await this.selectCandidatesInternal(ctx, exclude, max);
      safeMetric(() => {
        observeHistogram("matching_duration_ms", Date.now() - startedAt);
        observeHistogram("matching_candidate_count", outcome.candidatePoolSize);
        bumpCounter(
          outcome.offered.length > 0
            ? "matching_success_total"
            : "matching_no_driver_total",
        );
      });
      return outcome.offered;
    } catch (error) {
      safeMetric(() => {
        observeHistogram("matching_duration_ms", Date.now() - startedAt);
        bumpCounter("matching_error_total");
      });
      throw error;
    }
  }

  /**
   * المنطق الفعلي لاختيار المرشّحين. يعيد أيضًا حجم بركة المرشّحين قبل القطع
   * بـ max لأجل الرصد فقط — لا يُستخدم في أي قرار اختيار.
   */
  private async selectCandidatesInternal(
    ctx: MatchingContext,
    exclude: Set<string>,
    max: number,
  ): Promise<{ offered: string[]; candidatePoolSize: number }> {
    const nearby = await this.redis.nearbyDriversWithCoords(
      ctx.pickupLat,
      ctx.pickupLng,
      ctx.radiusKm,
    );
    const positionByUser = new Map(
      nearby.map((entry) => [
        entry.driverId,
        { lat: entry.lat, lng: entry.lng },
      ]),
    );
    const notExcluded = nearby
      .map((entry) => entry.driverId)
      .filter((id) => !exclude.has(id));
    if (notExcluded.length === 0) return { offered: [], candidatePoolSize: 0 };

    // استبعاد السائقين المحجوزين حاليًا لعرض آخر (مطابقة موزّعة، fail-open).
    let reserved = new Set<string>();
    try {
      const values = await this.redis.getKeys(
        notExcluded.map((id) => driverOfferKey(id)),
      );
      notExcluded.forEach((id, i) => {
        if (values[i] != null) reserved.add(id);
      });
    } catch {
      reserved = new Set<string>();
    }
    const userIds = filterUnreserved(notExcluded, reserved);
    if (userIds.length === 0) return { offered: [], candidatePoolSize: 0 };

    // 1) جلب دفعي لحالة "مشغول برحلة" (خط أنابيب واحد) تجنّبًا لـ N+1.
    const pipeline = this.redis.client.pipeline();
    for (const id of userIds) pipeline.get(`driver:${id}:trip`);
    const onTripRes = await pipeline.exec();
    const busy = new Set<string>();
    userIds.forEach((id, i) => {
      if (onTripRes?.[i]?.[1]) busy.add(id);
    });

    // 2) جلب دفعي للسائقين المؤهلين (الفلترة حسب نوع المركبة إن وُجد، وإلا rideClass).
    const vehicleFilter = ctx.vehicleTypeId
      ? { isActive: true, vehicleTypeId: ctx.vehicleTypeId }
      : { isActive: true, rideClass: ctx.rideClass };
    const eligible = await this.prisma.driver.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        availability: "ONLINE",
        vehicles: { some: vehicleFilter },
      },
      select: { userId: true, rating: true },
    });
    // ===== المرحلة ب: توجيه صارم حسب النوع (حُذف الاحتياط) =====
    // كان هنا تراجع يعيد الاستعلام بـ rideClass وحده إن لم يوجد سائق
    // مطابق للنوع، فكان طلب "دراجة نارية" يصل لسيارة عادية، وطلب
    // "نسائية" يصل لسائق لا ينتمي لهذا النوع. أُزيل نهائيًا:
    // عدم التوفر يُعالج في التطبيق ببطاقة "النوع غير متوفر في منطقتك" مع اقتراح
    // الأنواع المتوفرة فعلًا (GET /api/rides/availability)، لا بإرسال مركبة خاطئة.
    //
    // ملاحزة تشغيلية: سائق مركبته بلا vehicleTypeId لن يرى أي طلب موجّه
    // لنوع محدد؛ ربط المركبات القديمة بأنواع الكتالوج من لوحة التحكم إلزامي.
    const ratingByUser = new Map<string, number | null>(
      eligible.map((d) => [d.userId, d.rating ?? null]),
    );

    // 3) بناء المرشّحين مع رتبة القرب (ترتيب Redis GEO الأصلي).
    const candidates: DriverCandidate[] = [];
    userIds.forEach((id, index) => {
      if (busy.has(id) || !ratingByUser.has(id)) return;
      candidates.push({
        userId: id,
        proximityRank: index,
        rating: ratingByUser.get(id) ?? null,
      });
    });
    if (candidates.length === 0) return { offered: [], candidatePoolSize: 0 };

    // 4) إثراء المرشّحين بـ ETA حقيقي على شبكة الطرق قبل الترتيب.
    await this.enrichWithEta(candidates, positionByUser, ctx);

    // 5) تطبيق الاستراتيجية ثم الحد الأقصى.
    const offered = this.strategy
      .rank(candidates, ctx)
      .slice(0, max)
      .map((c) => c.userId);
    return { offered, candidatePoolSize: candidates.length };
  }

  /**
   * يملأ `etaSeconds` للمرشّحين الأقرب جغرافيًا (حتى ETA_CANDIDATE_LIMIT).
   * أي فشل يُترك الحقل فارغًا وترتد الاستراتيجية إلى ترتيب القرب.
   */
  private async enrichWithEta(
    candidates: DriverCandidate[],
    positionByUser: Map<string, { lat: number; lng: number }>,
    ctx: MatchingContext,
  ): Promise<void> {
    if (!this.routing) return;
    const shortlist = candidates
      .slice()
      .sort((a, b) => a.proximityRank - b.proximityRank)
      .slice(0, ETA_CANDIDATE_LIMIT)
      .filter((c) => positionByUser.has(c.userId));
    if (shortlist.length === 0) return;

    try {
      const etas = await this.routing.etaFromMany(
        shortlist.map((c) => positionByUser.get(c.userId)!),
        { lat: ctx.pickupLat, lng: ctx.pickupLng },
      );
      shortlist.forEach((candidate, i) => {
        const eta = etas[i];
        if (!eta) return;
        candidate.etaSeconds = eta.durationSeconds;
        candidate.roadDistanceMeters = eta.distanceMeters;
      });
    } catch (error) {
      this.logger.warn(
        `تعطّل حساب ETA للمرشحين: ${
          error instanceof Error ? error.message : "unknown"
        } — الترتيب بالقرب الجغرافي`,
      );
    }
  }
}
