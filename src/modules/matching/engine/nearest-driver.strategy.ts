import {
  DriverCandidate,
  MatchingContext,
  MatchingStrategy,
} from "./matching-strategy";

/**
 * الاستراتيجية الافتراضية: أقرب سائق (الحفاظ على ترتيب القرب).
 */
export class NearestDriverStrategy implements MatchingStrategy {
  readonly name = "NEAREST";

  rank(
    candidates: DriverCandidate[],
    _ctx: MatchingContext,
  ): DriverCandidate[] {
    return [...candidates].sort((a, b) => a.proximityRank - b.proximityRank);
  }
}

/**
 * استراتيجية "أفضل سائق": توازن بين القرب والتقييم (مثال جاهز للمستقبل).
 */
export class BestDriverStrategy implements MatchingStrategy {
  readonly name = "BEST_DRIVER";

  rank(
    candidates: DriverCandidate[],
    _ctx: MatchingContext,
  ): DriverCandidate[] {
    return [...candidates].sort((a, b) => {
      const ra = a.rating ?? 0;
      const rb = b.rating ?? 0;
      // الأعلى تقييمًا أولاً، ثم الأقرب عند التساوي.
      return rb - ra || a.proximityRank - b.proximityRank;
    });
  }
}
