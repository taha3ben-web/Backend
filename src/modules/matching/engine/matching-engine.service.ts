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
   */
  async selectCandidates(
    ctx: MatchingContext,
    exclude: Set<string>,
    max: number,
  ): Promise<string[]> {
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
    if (notExcluded.length === 0) return [];

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
    if (userIds.length === 0) return [];

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
    let eligible = await this.prisma.driver.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        availability: "ONLINE",
        vehicles: { some: vehicleFilter },
      },
      select: { userId: true, rating: true },
    });
    // تراجع لمطابقة rideClass إن لم يوجد أي سائق مطابق تمامًا لـ vehicleTypeId.
    // سائق مركبته لم تُربط بعد بنوع محدد من الكتالوج (vehicleTypeId فارغ) يبقى
    // ظاهرًا للمطابقة طالما فئة مركبته (rideClass) صحيحة - بدل أن يختفي تمامًا.
    if (ctx.vehicleTypeId && eligible.length === 0) {
      eligible = await this.prisma.driver.findMany({
        where: {
          userId: { in: userIds },
          status: "APPROVED",
          availability: "ONLINE",
          vehicles: { some: { isActive: true, rideClass: ctx.rideClass } },
        },
        select: { userId: true, rating: true },
      });
    }
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
    if (candidates.length === 0) return [];

    // 4) إثراء المرشّحين بـ ETA حقيقي على شبكة الطرق قبل الترتيب.
    await this.enrichWithEta(candidates, positionByUser, ctx);

    // 5) تطبيق الاستراتيجية ثم الحد الأقصى.
    return this.strategy
      .rank(candidates, ctx)
      .slice(0, max)
      .map((c) => c.userId);
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
