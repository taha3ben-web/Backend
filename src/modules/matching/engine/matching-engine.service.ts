import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  DriverCandidate,
  MatchingContext,
  MatchingStrategy,
} from "./matching-strategy";
import { NearestDriverStrategy } from "./nearest-driver.strategy";
import { driverOfferKey, filterUnreserved } from "../matching-lock.util";

/**
 * محرك المطابقة المستقل (Matching Engine).
 * مستقل تمامًا عن الـ Controller وعن حلقة العروض: مهمته اختيار
 * المرشّحين المؤهلين وترتيبهم وفق استراتيجية قابلة للتبديل.
 * الافتراضي: أقرب سائق (NEAREST). يمكن حقن استراتيجية أخرى مستقبلاً.
 */
@Injectable()
export class MatchingEngineService {
  private readonly logger = new Logger(MatchingEngineService.name);
  private strategy: MatchingStrategy = new NearestDriverStrategy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** تبديل استراتيجية المطابقة (أقرب/أفضل/مزاد/AI...). */
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
    const nearby = await this.redis.nearbyDrivers(
      ctx.pickupLat,
      ctx.pickupLng,
      ctx.radiusKm,
    );
    const notExcluded = nearby.filter((id) => !exclude.has(id));
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
    const eligible = await this.prisma.driver.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        availability: "ONLINE",
        vehicles: { some: vehicleFilter },
      },
      select: { userId: true, rating: true },
    });
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

    // 4) تطبيق الاستراتيجية ثم الحد الأقصى.
    return this.strategy
      .rank(candidates, ctx)
      .slice(0, max)
      .map((c) => c.userId);
  }
}
