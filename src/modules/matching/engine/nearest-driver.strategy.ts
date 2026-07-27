import {
  DriverCandidate,
  MatchingContext,
  MatchingStrategy,
} from "./matching-strategy";

/**
 * استراتيجية القرب الجغرافي: أقرب سائق بالمسافة الهوائية (ترتيب Redis GEO).
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
 * الاستراتيجية الافتراضية: **أسرع وصولًا** (لا أقرب جغرافيًا).
 *
 * لماذا هذا هو السلوك الصحيح: سائق على الضفة المقابلة من طريق مقسوم قد يكون
 * أقرب بـ 300 متر هوائية ولكن أبعد بـ 6 دقائق قيادة. الترتيب بـ ETA حقيقي يقلّل
 * زمن انتظار الراكب ويرفع معدل قبول السائقين.
 *
 * عند غياب ETA (محرك توجيه معطّل أو فاشل) يرتد تلقائيًا إلى رتبة القرب،
 * فلا تتوقف المطابقة أبدًا.
 */
export class FastestEtaStrategy implements MatchingStrategy {
  readonly name = "FASTEST_ETA";

  rank(
    candidates: DriverCandidate[],
    _ctx: MatchingContext,
  ): DriverCandidate[] {
    return [...candidates].sort((a, b) => {
      const ea = a.etaSeconds ?? null;
      const eb = b.etaSeconds ?? null;
      if (ea != null && eb != null && ea !== eb) return ea - eb;
      if (ea != null && eb == null) return -1;
      if (ea == null && eb != null) return 1;
      return a.proximityRank - b.proximityRank;
    });
  }
}

/**
 * استراتيجية "أفضل سائق": توازن بين التقييم وزمن الوصول.
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
      if (rb !== ra) return rb - ra;
      const ea = a.etaSeconds ?? Number.MAX_SAFE_INTEGER;
      const eb = b.etaSeconds ?? Number.MAX_SAFE_INTEGER;
      // الأعلى تقييمًا أولاً، ثم الأسرع وصولًا، ثم الأقرب.
      return ea - eb || a.proximityRank - b.proximityRank;
    });
  }
}
