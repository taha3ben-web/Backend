/**
 * ===== محرّك نقاط صدارة السائقين — الجزء النقيّ =====
 *
 * لا Nest ولا Prisma ولا Redis هنا: دوال نقيّة قابلة للاختبار مباشرة،
 * على نفس نهج profile-level.util.ts و growth.util.ts في هذا المشروع.
 *
 * لماذا ملف قواعد أصلًا؟
 * النسخة السابقة كانت تُحسب داخل driver-self.service.ts كـ
 * "score = عدد الرحلات المكتملة" مكتوبًا في TypeScript. كل تغيير تجاري
 * (وزن الرحلة، مكافأة تقييم، خصم إلغاء، حملة) كان يعني نشر كود جديد.
 * القواعد هنا تُقرأ من جدول Setting القائم (مفتاح واحد)، فتُدار من لوحة
 * التحكم عبر مسار الإعدادات المحكوم أصلًا (مسودة → مراجعة → نشر → مراجعات
 * + AuditLog)، بلا جدول جديد وبلا نظام تدقيق مواز.
 *
 * القيم الافتراضية أدناه ليست "أوزانًا مقترحة من عندنا": هي إعادة إنتاج
 * حرفية للسلوك المنشور اليوم (رحلة مكتملة واحدة = نقطة واحدة، ولا شيء
 * غير ذلك). كل قاعدة أخرى تُسلَّم مُعطَّلة بقيمة صفر حتى يعتمدها العمل
 * صراحةً من اللوحة. بهذا لا تتغير أرقام أي سائق في لحظة النشر.
 */

/** مفتاح الإعداد الواحد الذي يحكم المحرّك كلّه في جدول Setting. */
export const LEADERBOARD_SETTING_KEY = "driver.leaderboard";
/** مجموعة الإعداد في اللوحة (Setting.group). */
export const LEADERBOARD_SETTING_GROUP = "driver";
/** مجال ذاكرة التخزين في ConfigCacheService. */
export const LEADERBOARD_CACHE_NAMESPACE = "driver-leaderboard";

export const LEADERBOARD_PERIODS = ["WEEKLY", "MONTHLY", "ALL_TIME"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export const LEADERBOARD_SCOPES = ["NATIONAL", "WILAYA"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

/**
 * أنواع القواعد المدعومة.
 *
 * كل نوع هنا مبني على عمود موجود ومُتحقَّق منه في schema.prisma:
 *  - COMPLETED_TRIP        : Trip.status = COMPLETED (+ completedAt للفترة)
 *  - RATING_BONUS          : Driver.rating
 *  - PEAK_HOUR_TRIP        : Trip.completedAt (ساعة الإكمال)
 *  - CANCELLATION_PENALTY  : Trip.status = CANCELLED + Trip.cancelledBy = DRIVER
 *  - CAMPAIGN_MULTIPLIER   : مضاعِف زمني على المجموع (لا يحتاج عمودًا)
 *
 * لم نُضف أي مقياس لا يوجد له مصدر موثوق في القاعدة. تحديدًا
 * acceptance rate و streak غير مدعومين هنا لأن المشروع لا يخزّن
 * عروض التوصيل المرفوضة لكل سائق بشكل يمكن الاعتماد عليه
 * (NOT VERIFIED)، وإضافتهما كانت ستعني رقمًا لا يمكن إثباته.
 */
export const LEADERBOARD_RULE_TYPES = [
  "COMPLETED_TRIP",
  "RATING_BONUS",
  "PEAK_HOUR_TRIP",
  "CANCELLATION_PENALTY",
  "CAMPAIGN_MULTIPLIER",
] as const;
export type LeaderboardRuleType = (typeof LEADERBOARD_RULE_TYPES)[number];

export interface LeaderboardRule {
  /** معرّف نصّي ثابت للقاعدة داخل الإعداد (للتدقيق والعرض). */
  key: string;
  type: LeaderboardRuleType;
  enabled: boolean;
  /** القيمة: نقاط للوحدة، أو المضاعِف في CAMPAIGN_MULTIPLIER. */
  value: number;
  /** عتبة التقييم لـ RATING_BONUS. */
  threshold?: number | null;
  /** نافذة ساعات الذروة لـ PEAK_HOUR_TRIP (0..23، تدعم العبور بعد منتصف الليل). */
  startHour?: number | null;
  endHour?: number | null;
  /** نافذة سريان القاعدة (ISO). خارجها لا تُطبَّق. */
  startAt?: string | null;
  endAt?: string | null;
  /** نطاق القاعدة: كل الجزائر أو ولاية محددة. */
  scope: "ALL" | "WILAYA";
  wilayaId?: string | null;
  /** ترتيب التطبيق عند التساوي في النوع (الأصغر أولًا). */
  priority: number;
}

export interface LeaderboardEligibility {
  /** حالة السائق المطلوبة. النظام يعتمد APPROVED كما هو منشور اليوم. */
  requiredDriverStatus: "APPROVED";
  /** استثناء التعليق المؤقت النشط (Driver.suspendedUntil مستقبلًا). */
  excludeTemporarilySuspended: boolean;
  /** استثناء المستخدمين غير ACTIVE (User.status). */
  requireActiveUser: boolean;
  /** أقل عدد رحلات مكتملة داخل الفترة للظهور. 0 = لا شرط. */
  minCompletedTrips: number;
  /** أقل تقييم للظهور. 0 = لا شرط. */
  minRating: number;
}

export interface LeaderboardConfig {
  enabled: boolean;
  period: LeaderboardPeriod;
  /** عدد المتصدرين المُعاد افتراضيًا. */
  topLimit: number;
  /** أسبوع يبدأ الاثنين (1) أو الأحد (0) — يؤثر على نافذة WEEKLY. */
  weekStartsOn: 0 | 1;
  eligibility: LeaderboardEligibility;
  rules: LeaderboardRule[];
  cacheTtlSec: number;
}

/** حدود صلبة لا تتجاوزها اللوحة (حماية الأداء والصحة). */
export const LEADERBOARD_LIMITS = {
  minTop: 5,
  maxTop: 50,
  maxCacheTtlSec: 300,
  minCacheTtlSec: 0,
  maxAbsValue: 1_000_000,
  maxMultiplier: 10,
} as const;

/**
 * الإعداد الافتراضي = السلوك المنشور اليوم بالحرف.
 * COMPLETED_TRIP بقيمة 1 يعيد نفس رقم "عدد الرحلات المكتملة" السابق.
 */
export const DEFAULT_LEADERBOARD_CONFIG: LeaderboardConfig = {
  enabled: true,
  period: "ALL_TIME",
  topLimit: 20,
  weekStartsOn: 1,
  eligibility: {
    requiredDriverStatus: "APPROVED",
    excludeTemporarilySuspended: true,
    requireActiveUser: true,
    minCompletedTrips: 0,
    minRating: 0,
  },
  rules: [
    {
      key: "completed_trip",
      type: "COMPLETED_TRIP",
      enabled: true,
      value: 1,
      scope: "ALL",
      priority: 10,
    },
    {
      key: "rating_bonus",
      type: "RATING_BONUS",
      enabled: false,
      value: 0,
      threshold: 4.8,
      scope: "ALL",
      priority: 20,
    },
    {
      key: "peak_hour_trip",
      type: "PEAK_HOUR_TRIP",
      enabled: false,
      value: 0,
      startHour: 17,
      endHour: 21,
      scope: "ALL",
      priority: 30,
    },
    {
      key: "cancellation_penalty",
      type: "CANCELLATION_PENALTY",
      enabled: false,
      value: 0,
      scope: "ALL",
      priority: 40,
    },
    {
      key: "campaign_multiplier",
      type: "CAMPAIGN_MULTIPLIER",
      enabled: false,
      value: 1,
      scope: "ALL",
      priority: 50,
    },
  ],
  cacheTtlSec: 60,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** يقرأ الفترة من نص حر (استعلام أو إعداد) وإلا يعيد null. */
export function parseLeaderboardPeriod(raw: unknown): LeaderboardPeriod | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase().replace(/-/g, "_");
  return (LEADERBOARD_PERIODS as readonly string[]).includes(upper)
    ? (upper as LeaderboardPeriod)
    : null;
}

/**
 * يقرأ النطاق مع دعم الأسماء القديمة المستخدمة في تطبيق السائق الحالي:
 * scope=city  -> WILAYA (التبويب المحلي)
 * scope=country -> NATIONAL
 * كسر هذين الاسمين يعني كسر التطبيق المنشور، فأبقيناهما مرادفين.
 */
export function parseLeaderboardScope(raw: unknown): LeaderboardScope | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "NATIONAL" || v === "COUNTRY") return "NATIONAL";
  if (v === "WILAYA" || v === "CITY" || v === "LOCAL") return "WILAYA";
  return null;
}

/** يحوّل النطاق الداخلي إلى الاسم القديم المتوقَّع في الرد. */
export function legacyScopeName(scope: LeaderboardScope): "city" | "country" {
  return scope === "NATIONAL" ? "country" : "city";
}

/** يقصّ حدّ المتصدرين المطلوب من العميل إلى المدى المسموح. */
export function normalizeTopLimit(raw: unknown, fallback: number): number {
  const n = num(raw, fallback);
  return clamp(
    Math.trunc(n) || fallback,
    LEADERBOARD_LIMITS.minTop,
    LEADERBOARD_LIMITS.maxTop,
  );
}

export interface NormalizedConfigResult {
  config: LeaderboardConfig;
  /** ملاحظات تُعرَض للمشرف في اللوحة بدل رفض الإعداد وتعطيل الشاشة. */
  warnings: string[];
}

/**
 * يطهّر إعداد اللوحة قبل أي استخدام.
 *
 * القاعدة: إعداد فاسد لا يُسقِط الشاشة ولا يُنتج ترتيبًا عشوائيًا؛
 * تُستبدل الحقول غير الصالحة بالافتراضي وتُسجّل ملاحظة. هذا مقصود:
 * الصدارة شاشة قراءة، وإسقاطها بسبب حرف خاطئ في JSON أسوأ من تجاهله.
 */
export function normalizeLeaderboardConfig(
  raw: unknown,
): NormalizedConfigResult {
  const warnings: string[] = [];
  const src = (raw ?? {}) as Record<string, unknown>;
  if (raw !== null && raw !== undefined && typeof raw !== "object") {
    warnings.push(
      "القيمة المخزّنة ليست كائن JSON — استُخدم الإعداد الافتراضي.",
    );
  }

  const period =
    parseLeaderboardPeriod(src.period) ?? DEFAULT_LEADERBOARD_CONFIG.period;
  if (src.period !== undefined && !parseLeaderboardPeriod(src.period)) {
    warnings.push(
      `فترة غير معروفة (${String(src.period)}) — استُخدم ${period}.`,
    );
  }

  const eligSrc = (src.eligibility ?? {}) as Record<string, unknown>;
  const def = DEFAULT_LEADERBOARD_CONFIG;
  const eligibility: LeaderboardEligibility = {
    requiredDriverStatus: "APPROVED",
    excludeTemporarilySuspended: bool(
      eligSrc.excludeTemporarilySuspended,
      def.eligibility.excludeTemporarilySuspended,
    ),
    requireActiveUser: bool(
      eligSrc.requireActiveUser,
      def.eligibility.requireActiveUser,
    ),
    minCompletedTrips: clamp(
      Math.trunc(
        num(eligSrc.minCompletedTrips, def.eligibility.minCompletedTrips),
      ),
      0,
      100_000,
    ),
    minRating: clamp(num(eligSrc.minRating, def.eligibility.minRating), 0, 5),
  };

  const rawRules = Array.isArray(src.rules) ? src.rules : null;
  if (src.rules !== undefined && !rawRules) {
    warnings.push("rules ليست مصفوفة — استُخدمت القواعد الافتراضية.");
  }

  const seen = new Set<string>();
  const rules: LeaderboardRule[] = (rawRules ?? def.rules)
    .map((entry, index) => normalizeRule(entry, index, warnings))
    .filter((rule): rule is LeaderboardRule => rule !== null)
    .filter((rule) => {
      if (seen.has(rule.key)) {
        warnings.push(`قاعدة مكرّرة (${rule.key}) — أُخذت الأولى فقط.`);
        return false;
      }
      seen.add(rule.key);
      return true;
    })
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));

  if (!rules.some((r) => r.enabled)) {
    warnings.push(
      "لا قاعدة مُفعّلة: كل النقاط ستكون صفرًا والترتيب سيعتمد على التقييم ثم المعرّف.",
    );
  }

  return {
    config: {
      enabled: bool(src.enabled, def.enabled),
      period,
      topLimit: normalizeTopLimit(src.topLimit, def.topLimit),
      weekStartsOn: num(src.weekStartsOn, def.weekStartsOn) === 0 ? 0 : 1,
      eligibility,
      rules,
      cacheTtlSec: clamp(
        Math.trunc(num(src.cacheTtlSec, def.cacheTtlSec)),
        LEADERBOARD_LIMITS.minCacheTtlSec,
        LEADERBOARD_LIMITS.maxCacheTtlSec,
      ),
    },
    warnings,
  };
}

function normalizeRule(
  entry: unknown,
  index: number,
  warnings: string[],
): LeaderboardRule | null {
  if (!entry || typeof entry !== "object") {
    warnings.push(`القاعدة رقم ${index + 1} ليست كائنًا — أُسقطت.`);
    return null;
  }
  const r = entry as Record<string, unknown>;
  const type = String(r.type ?? "").toUpperCase() as LeaderboardRuleType;
  if (!(LEADERBOARD_RULE_TYPES as readonly string[]).includes(type)) {
    warnings.push(`نوع قاعدة غير مدعوم (${String(r.type)}) — أُسقطت.`);
    return null;
  }

  const isMultiplier = type === "CAMPAIGN_MULTIPLIER";
  const rawValue = num(r.value, isMultiplier ? 1 : 0);
  const value = isMultiplier
    ? clamp(rawValue, 0, LEADERBOARD_LIMITS.maxMultiplier)
    : clamp(
        rawValue,
        -LEADERBOARD_LIMITS.maxAbsValue,
        LEADERBOARD_LIMITS.maxAbsValue,
      );
  if (value !== rawValue) {
    warnings.push(
      `قيمة القاعدة (${String(r.key ?? type)}) خارج المدى — قُصّت.`,
    );
  }

  const scope =
    String(r.scope ?? "ALL").toUpperCase() === "WILAYA" ? "WILAYA" : "ALL";
  const wilayaId =
    typeof r.wilayaId === "string" && r.wilayaId.trim() ? r.wilayaId : null;
  if (scope === "WILAYA" && !wilayaId) {
    warnings.push(
      `القاعدة (${String(r.key ?? type)}) بنطاق ولاية بلا wilayaId — عُوملت كنطاق وطني.`,
    );
  }

  const startAt = isoOrNull(r.startAt);
  const endAt = isoOrNull(r.endAt);
  if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
    warnings.push(
      `القاعدة (${String(r.key ?? type)}) تبدأ بعد نهايتها — لن تُطبَّق أبدًا.`,
    );
  }

  const hour = (raw: unknown, fallback: number) =>
    clamp(Math.trunc(num(raw, fallback)), 0, 23);

  return {
    key:
      typeof r.key === "string" && r.key.trim()
        ? r.key.trim()
        : `${type.toLowerCase()}_${index}`,
    type,
    enabled: bool(r.enabled, false),
    value,
    threshold:
      type === "RATING_BONUS" ? clamp(num(r.threshold, 4.8), 0, 5) : null,
    startHour: type === "PEAK_HOUR_TRIP" ? hour(r.startHour, 17) : null,
    endHour: type === "PEAK_HOUR_TRIP" ? hour(r.endHour, 21) : null,
    startAt,
    endAt,
    scope: scope === "WILAYA" && wilayaId ? "WILAYA" : "ALL",
    wilayaId: scope === "WILAYA" && wilayaId ? wilayaId : null,
    priority: clamp(Math.trunc(num(r.priority, 100)), 0, 10_000),
  };
}

/** نافذة الفترة: [from, to) بتوقيت UTC. ALL_TIME بلا حدود. */
export interface PeriodWindow {
  period: LeaderboardPeriod;
  from: Date | null;
  to: Date | null;
}

/**
 * يحسب نافذة الفترة الحالية.
 *
 * ملاحظة صريحة: الحدود بتوقيت UTC لأن كل طوابع الرحلات في القاعدة UTC.
 * الجزائر UTC+1 ثابتة بلا توقيت صيفي، فالانحراف يوم كامل لا يظهر إلا في
 * أول ساعة من اليوم المحلي؛ توثيقه أصدق من ادّعاء ضبط محلي غير منفَّذ.
 */
export function resolvePeriodWindow(
  period: LeaderboardPeriod,
  now: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): PeriodWindow {
  if (period === "ALL_TIME") return { period, from: null, to: null };

  if (period === "MONTHLY") {
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
    );
    return { period, from, to };
  }

  const day = now.getUTCDay();
  const diff = weekStartsOn === 1 ? (day + 6) % 7 : day;
  const from = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  from.setUTCDate(from.getUTCDate() - diff);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { period, from, to };
}

/** هل القاعدة سارية الآن ولهذه الولاية؟ */
export function isRuleActive(
  rule: LeaderboardRule,
  now: Date,
  wilayaId: string | null,
): boolean {
  if (!rule.enabled) return false;
  if (rule.startAt && new Date(rule.startAt) > now) return false;
  if (rule.endAt && new Date(rule.endAt) <= now) return false;
  if (rule.scope === "WILAYA" && rule.wilayaId !== wilayaId) return false;
  return true;
}

/**
 * المعاملات المستخرجة من القواعد السارية.
 * هذه هي الواجهة الوحيدة بين القواعد و SQL: الاستعلام لا يقرأ القواعد،
 * بل يستقبل أرقامًا مُتحقَّقًا منها، فلا يمكن لإعداد اللوحة أن يحقن SQL.
 */
export interface ScoreCoefficients {
  perCompletedTrip: number;
  perPeakTrip: number;
  peakStartHour: number;
  peakEndHour: number;
  ratingBonus: number;
  ratingThreshold: number;
  perDriverCancellation: number;
  campaignMultiplier: number;
  /** مفاتيح القواعد التي أنتجت هذه المعاملات (للتدقيق والعرض). */
  appliedRuleKeys: string[];
}

export function resolveCoefficients(
  config: LeaderboardConfig,
  now: Date = new Date(),
  wilayaId: string | null = null,
): ScoreCoefficients {
  const coeffs: ScoreCoefficients = {
    perCompletedTrip: 0,
    perPeakTrip: 0,
    peakStartHour: 0,
    peakEndHour: 0,
    ratingBonus: 0,
    ratingThreshold: 5,
    perDriverCancellation: 0,
    campaignMultiplier: 1,
    appliedRuleKeys: [],
  };

  for (const rule of config.rules) {
    if (!isRuleActive(rule, now, wilayaId)) continue;
    switch (rule.type) {
      case "COMPLETED_TRIP":
        coeffs.perCompletedTrip += rule.value;
        break;
      case "PEAK_HOUR_TRIP":
        coeffs.perPeakTrip += rule.value;
        coeffs.peakStartHour = rule.startHour ?? 0;
        coeffs.peakEndHour = rule.endHour ?? 0;
        break;
      case "RATING_BONUS":
        coeffs.ratingBonus += rule.value;
        coeffs.ratingThreshold = rule.threshold ?? 5;
        break;
      case "CANCELLATION_PENALTY":
        // القيمة تُدخل موجبة في اللوحة وتُخصم هنا: أقل لبسًا للمشرف.
        coeffs.perDriverCancellation += Math.abs(rule.value);
        break;
      case "CAMPAIGN_MULTIPLIER":
        coeffs.campaignMultiplier *= rule.value;
        break;
    }
    coeffs.appliedRuleKeys.push(rule.key);
  }

  return coeffs;
}

/** المقاييس المشتقة من الخادم لسائق واحد داخل الفترة. */
export interface DriverMetrics {
  completedTrips: number;
  peakTrips: number;
  driverCancellations: number;
  rating: number;
}

/**
 * صيغة النقاط. نفس الحساب المنفَّذ في SQL حرفيًا، وموجود هنا
 * ليكون قابلًا للاختبار بلا قاعدة بيانات ولمقارنة أي انحراف.
 *
 * score = round(
 *   ( completed*perTrip + peak*perPeak + (rating>=t ? bonus : 0)
 *     - cancels*penalty ) * campaign
 * )
 * ولا تنزل عن صفر: ترتيب بنقاط سالبة يخلق حافزًا لإخفاء النشاط.
 */
export function computeScore(
  coeffs: ScoreCoefficients,
  metrics: DriverMetrics,
): number {
  const base =
    metrics.completedTrips * coeffs.perCompletedTrip +
    metrics.peakTrips * coeffs.perPeakTrip +
    (coeffs.ratingBonus > 0 && metrics.rating >= coeffs.ratingThreshold
      ? coeffs.ratingBonus
      : 0) -
    metrics.driverCancellations * coeffs.perDriverCancellation;
  return Math.max(0, Math.round(base * coeffs.campaignMultiplier));
}

/** صف ترتيب مجرَّد (ما يكفي لتحديد المركز). */
export interface RankableRow {
  driverId: string;
  score: number;
  rating: number;
  completedTrips: number;
}

/**
 * فاصل التعادل النهائي — وهو **كليّ** (total order):
 *   score DESC → rating DESC → completedTrips DESC → driverId ASC
 * وبما أن driverId فريد فلا يمكن أن يتساوى صفّان تمامًا، لذلك:
 * الترتيب المستخدم **ordinal (1,2,3,4)** لا competition ولا dense،
 * ولا يوجد مركز مكرّر أصلًا. نفس البيانات تعطي نفس الترتيب دائمًا.
 * SQL يستعمل ROW_NUMBER() بنفس هذا الترتيب حرفيًا.
 */
export function compareForRanking(a: RankableRow, b: RankableRow): number {
  return (
    b.score - a.score ||
    b.rating - a.rating ||
    b.completedTrips - a.completedTrips ||
    a.driverId.localeCompare(b.driverId)
  );
}

/** يرتّب ويمنح مراكز ordinal. مرجع الاختبارات ومقارنة نتائج SQL. */
export function rankRows<T extends RankableRow>(
  rows: T[],
): Array<T & { rank: number }> {
  return [...rows]
    .sort(compareForRanking)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** فارق النقاط عن المركز الذي يسبق وعن المتصدر. */
export interface ScoreGap {
  pointsToNext: number | null;
  pointsToLeader: number | null;
}

export function computeGap(
  myScore: number | null,
  nextScore: number | null,
  leaderScore: number | null,
): ScoreGap {
  if (myScore === null) return { pointsToNext: null, pointsToLeader: null };
  return {
    pointsToNext: nextScore === null ? null : Math.max(0, nextScore - myScore),
    pointsToLeader:
      leaderScore === null ? null : Math.max(0, leaderScore - myScore),
  };
}

/**
 * وحدة النقاط كمفتاح لا كنص مترجم: التطبيق يترجمها (عربي/فرنسي/إنجليزي).
 * TRIP عندما تكون رحلة مكتملة واحدة = نقطة واحدة ولا قاعدة أخرى مفعّلة
 * (وهو الحال الافتراضي اليوم)، وإلا POINT.
 */
export function resolveScoreUnitKey(
  coeffs: ScoreCoefficients,
): "TRIP" | "POINT" {
  const onlyTrips =
    coeffs.perCompletedTrip === 1 &&
    coeffs.perPeakTrip === 0 &&
    coeffs.ratingBonus === 0 &&
    coeffs.perDriverCancellation === 0 &&
    coeffs.campaignMultiplier === 1;
  return onlyTrips ? "TRIP" : "POINT";
}

/**
 * النص العربي القديم لحقل scoreUnit المنشور.
 * موجود للتوافق الخلفي فقط (التطبيق الحالي يعرضه كما هو) وهو مُعلَن
 * كـ deprecated في الرد؛ الحقل الصحيح للترجمة هو scoreUnitKey.
 */
export function legacyScoreUnitLabel(unitKey: "TRIP" | "POINT"): string {
  return unitKey === "TRIP" ? "رحلة" : "نقطة";
}
