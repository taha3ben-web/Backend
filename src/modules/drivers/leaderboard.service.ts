import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigCacheService } from "../../common/infra/config-cache.service";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { ProfileLevelsService } from "../profile-levels/profile-levels.service";
import {
  DEFAULT_LEADERBOARD_CONFIG,
  LEADERBOARD_CACHE_NAMESPACE,
  LEADERBOARD_SETTING_KEY,
  computeGap,
  legacyScopeName,
  legacyScoreUnitLabel,
  normalizeLeaderboardConfig,
  normalizeTopLimit,
  parseLeaderboardPeriod,
  parseLeaderboardScope,
  resolveCoefficients,
  resolvePeriodWindow,
  resolveScoreUnitKey,
  type LeaderboardConfig,
  type LeaderboardPeriod,
  type LeaderboardScope,
  type ScoreCoefficients,
} from "./leaderboard.util";

/**
 * ===== محرّك صدارة السائقين =====
 *
 * المشكلة التي يحلّها هذا الملف:
 * النسخة السابقة (DriverSelfService.leaderboard) كانت تجلب `take: 1000`
 * سائق **بلا orderBy** ثم ترتّبهم في Node. أربع نتائج لذلك:
 *  1. على مستوى الجزائر كان الترتيب "أول ألف سائق ترجعهم القاعدة" لا المتصدرين.
 *  2. بلا orderBy فالعينة نفسها غير مستقرة بين طلبين — ترتيب يرتجف.
 *  3. سائق خارج الألف لا يرى مرتبته إطلاقًا (me = null).
 *  4. المعادلة مدفونة في TypeScript فلا يملكها العمل.
 *
 * الحل هنا:
 *  - الترتيب يُحسب في PostgreSQL بـ ROW_NUMBER()/COUNT() OVER على كل المؤهلين،
 *    ويُعاد من القاعدة صفّا المتصدرين فقط + صف السائق نفسه. لا فرز في Node.
 *  - المعاملات تأتي من جدول Setting القائم عبر leaderboard.util (مُطهرة ومقصوصة).
 *  - الولاية تُستخرج من ملف السائق المرتبط بالتوكن، ولا تُقرأ من الطلب أبدًا.
 *
 * ما لا يفعله هذا الملف (ولا يدّعيه):
 *  - لا يخزّن نقاطًا ولا يرفع عدّادًا عند إتمام رحلة. النقاط **مشتقة** من
 *    حالة الرحلات وقت القراءة. لذلك لا يوجد مسار يمنح نقاطًا مرتين:
 *    إعادة محاولة أي worker أو webhook لا تغير النتيجة (idempotent بنيويًا، لا بمفتاح).
 *  - ليس نطاقًا لحساب الأموال: لا يلمس DriverEarning ولا LedgerTransaction ولا الولاء.
 *  - ليس زمنًا حقيقيًا (غير real-time): الرد مخزّن لمدة cacheTtlSec ويُعلن ذلك
 *    في الرد نفسه (period.updatedAt و period.cachedTtlSec).
 */

/** السبب المُعلن عند عدم وجود ولاية صالحة للسائق. */
export const WILAYA_UNAVAILABLE = "WILAYA_UNAVAILABLE";

interface MyPositionRow {
  score: number;
  rating: number;
  completed_trips: number;
  national_rank: number;
  national_total: number;
  national_leader_score: number;
  national_next_score: number | null;
  wilaya_rank: number | null;
  wilaya_total: number | null;
  wilaya_leader_score: number | null;
  wilaya_next_score: number | null;
}

interface TopRow {
  id: string;
  score: number;
  rating: number;
  completed_trips: number;
  national_rank: number;
  wilaya_rank: number | null;
  name: string | null;
  avatar_url: string | null;
  city_name: string | null;
  wilaya_name_ar: string | null;
  wilaya_name_fr: string | null;
  wilaya_name_en: string | null;
}

export interface LeaderboardQuery {
  scope?: string;
  period?: string;
  limit?: number | string;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger("DriverLeaderboard");

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ConfigCacheService,
    private readonly storage: StorageService,
    private readonly profileLevels: ProfileLevelsService,
  ) {}

  // ===================== الإعداد =====================

  /**
   * يقرأ الإعداد من جدول Setting بنفس دلالة SettingsService.getValue
   * (المنشور للإعدادات العامة، وإلا قيمة المسودة)، من دون ربط دائري
   * بين وحدة السائقين ووحدة الإعدادات.
   *
   * الكتابة ليست هنا إطلاقًا: تمرّ عبر مسار الإعدادات المحكوم أصلًا
   * (مسودة → مراجعة → نشر → SettingRevision) فيُعرف من غير ومتى وماذا،
   * بلا نظام تدقيق موازٍ.
   */
  async loadConfig(): Promise<{
    config: LeaderboardConfig;
    warnings: string[];
    version: number | null;
    updatedAt: Date | null;
  }> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: LEADERBOARD_SETTING_KEY } })
      .catch((error: unknown) => {
        this.logger.warn(
          `تعذر قراءة إعداد الصدارة: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });

    if (!row) {
      return {
        config: DEFAULT_LEADERBOARD_CONFIG,
        warnings: [],
        version: null,
        updatedAt: null,
      };
    }

    const raw =
      row.isPublic && row.publishedValue !== null
        ? row.publishedValue
        : row.value;
    const { config, warnings } = normalizeLeaderboardConfig(raw);
    return {
      config,
      warnings,
      version: row.isPublic ? row.publishedVersion : row.version,
      updatedAt: row.updatedAt ?? null,
    };
  }

  // ===================== الواجهة الرئيسية =====================

  /**
   * الرد الكامل لتطبيق السائق: مرتبته وطنيًا وفي ولايته، المتصدرون،
   * فوارق النقاط، الفترة الفعّالة، والقواعد المُطبّقة.
   */
  async summary(userId: string, query: LeaderboardQuery = {}) {
    const driver = await this.requireDriver(userId);
    const { config, version, updatedAt } = await this.loadConfig();

    // الفترة: يجوز للعميل أن يختار فترة معروفة (قراءة لا تأثير على النقاط)،
    // وأي قيمة غير معروفة تسقط إلى فترة الإعداد، ولا تُمرّر إلى SQL أبدًا.
    const period: LeaderboardPeriod =
      parseLeaderboardPeriod(query.period) ?? config.period;
    const scope: LeaderboardScope =
      parseLeaderboardScope(query.scope) ?? "WILAYA";
    const limit = normalizeTopLimit(query.limit, config.topLimit);

    const now = new Date();
    const window = resolvePeriodWindow(period, now, config.weekStartsOn);

    // الولاية من الخادم فقط. لا يوجد أي مسار يقبل wilayaId من الطلب.
    const wilayaId = driver.wilayaId ?? null;
    const coeffs = resolveCoefficients(config, now, wilayaId);
    const unitKey = resolveScoreUnitKey(coeffs);

    if (!config.enabled) {
      return this.disabledPayload(period, scope, config, version, updatedAt);
    }

    const cacheKey = this.cache.key(LEADERBOARD_CACHE_NAMESPACE, {
      driverId: driver.id,
      period,
      scope,
      limit,
      wilayaId,
      version,
    });

    const load = async () => {
      const [me, tops] = await Promise.all([
        this.queryMyPosition(driver.id, config, coeffs, window),
        this.queryTopRows(config, coeffs, window, wilayaId, limit),
      ]);
      return { me, tops, computedAt: new Date().toISOString() };
    };

    const data =
      config.cacheTtlSec > 0
        ? await this.cache.remember(cacheKey, load, config.cacheTtlSec)
        : await load();

    const me = data.me;
    const nationalRows = data.tops.filter((r) => r.national_rank <= limit);
    const wilayaRows = wilayaId
      ? data.tops.filter(
          (r) => r.wilaya_rank !== null && r.wilaya_rank <= limit,
        )
      : [];

    const [nationalLeaders, wilayaLeaders] = await Promise.all([
      this.decorateRows(nationalRows, "NATIONAL", driver.id, unitKey),
      this.decorateRows(wilayaRows, "WILAYA", driver.id, unitKey),
    ]);

    const nationalGap = computeGap(
      me?.score ?? null,
      me?.national_next_score ?? null,
      me?.national_leader_score ?? null,
    );
    const wilayaGap = computeGap(
      me && me.wilaya_rank !== null ? me.score : null,
      me?.wilaya_next_score ?? null,
      me?.wilaya_leader_score ?? null,
    );

    // مستوى الملف يُعرض بجانب الصدارة لكنه **نظام منفصل**:
    // مشتق من عدد الرحلات المكتملة مدى الحياة وليس من نقاط الصدارة.
    // لذلك يُعلن مصدره صراحةً حتى لا تختلط المفاهيم في التطبيق.
    const level = await this.profileLevels
      .forDriver(driver.id)
      .catch(() => null);

    return {
      enabled: true,
      scope: legacyScopeName(scope),
      scopeKey: scope,
      period: {
        period,
        from: window.from ? window.from.toISOString() : null,
        to: window.to ? window.to.toISOString() : null,
        /** متى حُسبت هذه النسخة فعليًا (ليس زمن الطلب). */
        computedAt: data.computedAt,
        /** مدة التخزين: الرد قد يتأخر عن القاعدة بهذا القدر. ليس زمنًا حقيقيًا. */
        cachedTtlSec: config.cacheTtlSec,
        supported: ["WEEKLY", "MONTHLY", "ALL_TIME"],
      },
      scoring: {
        /** مفتاح وحدة النقاط — الترجمة مسؤولية التطبيق (ar/fr/en/RTL). */
        scoreUnitKey: unitKey,
        configVersion: version,
        configUpdatedAt: updatedAt ? updatedAt.toISOString() : null,
        appliedRuleKeys: coeffs.appliedRuleKeys,
      },
      national: {
        rank: me?.national_rank ?? null,
        score: me?.score ?? null,
        totalDrivers: me?.national_total ?? null,
        pointsToNext: nationalGap.pointsToNext,
        pointsToLeader: nationalGap.pointsToLeader,
        topDrivers: nationalLeaders,
      },
      wilaya: wilayaId
        ? {
            available: true,
            wilayaId,
            rank: me?.wilaya_rank ?? null,
            score: me && me.wilaya_rank !== null ? me.score : null,
            totalDrivers: me?.wilaya_total ?? null,
            pointsToNext: wilayaGap.pointsToNext,
            pointsToLeader: wilayaGap.pointsToLeader,
            topDrivers: wilayaLeaders,
          }
        : {
            // لا تخمين ولا قبول ولاية من العميل: حالة مُعلنة واضحة.
            available: false,
            reason: WILAYA_UNAVAILABLE,
            wilayaId: null,
            rank: null,
            score: null,
            totalDrivers: null,
            pointsToNext: null,
            pointsToLeader: null,
            topDrivers: [],
          },
      me: me
        ? {
            driverId: driver.id,
            rankNational: me.national_rank,
            rankWilaya: me.wilaya_rank,
            score: me.score,
            rating: Number(me.rating),
            completedTrips: me.completed_trips,
            isMe: true,
          }
        : null,
      /** مستوى الملف الشخصي — نظام منفصل عن نقاط الصدارة، مُعلن المصدر. */
      profileLevel: level
        ? {
            system: "PROFILE_LEVELS",
            level: level.profileLevel,
            completedTripsCount: level.completedTripsCount,
          }
        : null,
    };
  }

  /**
   * الشكل المنشور لـ GET /api/driver/leaderboard.
   *
   * كل حقول العقد القديم محفوظة بأسمائها ودلالتها:
   * scope | localBasis | period | available | total | rows[] | me
   * وكل صف: rank | driverId | name | photoUrl | cityName | score | scoreUnit | rating | isMe
   * وأُضيفت حقول جديدة فقط (إضافة لا تغيير)، فالتطبيق المنشور يعمل كما هو.
   *
   * الفرق الوحيد في الدلالة: period كان نصًا "ALL_TIME" دائمًا وبقي نصًا،
   * لكنه الآن يعكس الفترة الفعّالة من الإعداد. الافتراضي المنشور ALL_TIME
   * فلا يتغير شيء قبل أن يغيره العمل من اللوحة.
   */
  async legacyView(userId: string, scopeRaw?: string, limitRaw?: number) {
    const driver = await this.requireDriver(userId);
    const scope: LeaderboardScope = parseLeaderboardScope(scopeRaw) ?? "WILAYA";

    const full = await this.summary(userId, {
      scope: scope,
      limit: limitRaw,
    });

    // localBasis يعلن أساس التبويب المحلي. كان يقبل "city" عند وجود cityId؛
    // المحرك الجديد يرتّب بالولاية حصرًا لأن المطلوب "ترتيب داخل الولاية"،
    // وإعلان "city" مع ترتيب ولاية كان سيكون كذبًا على التطبيق.
    const localBasis = driver.wilayaId ? "wilaya" : null;

    const isNational = scope === "NATIONAL";
    const side = isNational ? full.national : full.wilaya;
    const available = isNational
      ? full.enabled
      : full.enabled && full.wilaya.available;

    const unitLabel = legacyScoreUnitLabel(
      full.scoring.scoreUnitKey as "TRIP" | "POINT",
    );

    const rows = side.topDrivers.map((r) => ({ ...r, scoreUnit: unitLabel }));
    const meRow =
      full.me && available
        ? {
            rank: isNational ? full.me.rankNational : full.me.rankWilaya,
            driverId: full.me.driverId,
            name: null as string | null,
            photoUrl: null as string | null,
            cityName: null as string | null,
            score: full.me.score,
            scoreUnit: unitLabel,
            rating: full.me.rating,
            isMe: true,
          }
        : null;
    const meFromRows = rows.find((r) => r.isMe) ?? null;

    return {
      scope: legacyScopeName(scope),
      localBasis,
      period: full.period.period,
      available,
      total: side.totalDrivers ?? 0,
      rows,
      me: meFromRows ?? meRow,
      // ===== إضافات غير كاسرة =====
      /** مفتاح الوحدة للترجمة. scoreUnit العربي أعلاه متروك للتوافق ومُعتبر deprecated. */
      scoreUnitKey: full.scoring.scoreUnitKey,
      national: full.national,
      wilaya: full.wilaya,
      meDetailed: full.me,
      periodDetails: full.period,
      scoring: full.scoring,
      profileLevel: full.profileLevel,
    };
  }

  // ===================== الاستعلامات =====================

  /** شروط الأهلية — مشتقة من حالات النظام القائمة لا مخترعة. */
  private eligibilitySql(config: LeaderboardConfig): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`d."status" = 'APPROVED'::"DriverStatus"`,
    ];
    if (config.eligibility.requireActiveUser) {
      parts.push(Prisma.sql`u."status" = 'ACTIVE'::"UserStatus"`);
    }
    if (config.eligibility.excludeTemporarilySuspended) {
      parts.push(
        Prisma.sql`(d."suspendedUntil" IS NULL OR d."suspendedUntil" <= now())`,
      );
    }
    if (config.eligibility.minRating > 0) {
      parts.push(Prisma.sql`d."rating" >= ${config.eligibility.minRating}`);
    }
    return Prisma.join(parts, " AND ");
  }

  /** نافذة الفترة كشرط SQL على عمود محدد. */
  private windowSql(
    column: Prisma.Sql,
    from: Date | null,
    to: Date | null,
  ): Prisma.Sql {
    if (!from && !to) return Prisma.empty;
    const parts: Prisma.Sql[] = [];
    if (from) parts.push(Prisma.sql`${column} >= ${from}`);
    if (to) parts.push(Prisma.sql`${column} < ${to}`);
    return Prisma.sql` AND ${Prisma.join(parts, " AND ")}`;
  }

  /**
   * جسم الاستعلام المشترك: المؤهلون → المقاييس → النقاط → المراتب.
   *
   * المعاملات تدخل كـ bind parameters مقصوصة عدديًا في leaderboard.util،
   * فلا يمكن لإعداد لوحة أن يحقن SQL ولا أن يغير شكل الاستعلام.
   *
   * الترتيب هنا هو نفس compareForRanking حرفيًا:
   * score DESC, rating DESC, completed DESC, id ASC — وهو ترتيب كليّ
   * (id فريد) فلا توجد مراتب مكررة ولا عشوائية بين الطلبات.
   */
  private rankedCte(
    config: LeaderboardConfig,
    coeffs: ScoreCoefficients,
    window: { from: Date | null; to: Date | null },
  ): Prisma.Sql {
    const peakEnabled = coeffs.perPeakTrip !== 0;
    // نافذة الذروة تدعم العبور بعد منتصف الليل (مثل 22→٢).
    const peakFilter = peakEnabled
      ? coeffs.peakStartHour <= coeffs.peakEndHour
        ? Prisma.sql`EXTRACT(HOUR FROM t."completedAt") >= ${coeffs.peakStartHour} AND EXTRACT(HOUR FROM t."completedAt") < ${coeffs.peakEndHour}`
        : Prisma.sql`EXTRACT(HOUR FROM t."completedAt") >= ${coeffs.peakStartHour} OR EXTRACT(HOUR FROM t."completedAt") < ${coeffs.peakEndHour}`
      : Prisma.sql`false`;

    const cancelJoin =
      coeffs.perDriverCancellation !== 0
        ? Prisma.sql`
          LEFT JOIN (
            SELECT t."driverId" AS did, COUNT(*)::int AS cancels
            FROM "Trip" t
            WHERE t."driverId" IS NOT NULL
              AND t."status" = 'CANCELLED'::"TripStatus"
              AND t."cancelledBy" = 'DRIVER'::"ActorKind"
              ${this.windowSql(Prisma.sql`t."updatedAt"`, window.from, window.to)}
            GROUP BY t."driverId"
          ) cx ON cx.did = e.id`
        : Prisma.empty;

    const cancelExpr =
      coeffs.perDriverCancellation !== 0
        ? Prisma.sql`- COALESCE(cx.cancels, 0) * ${coeffs.perDriverCancellation}`
        : Prisma.empty;

    const orderBy = Prisma.sql`s.score DESC, s.rating DESC, s.completed_trips DESC, s.id ASC`;

    return Prisma.sql`
      WITH eligible AS (
        SELECT d."id" AS id, d."wilayaId" AS wilaya_id, d."rating" AS rating
        FROM "Driver" d
        JOIN "User" u ON u."id" = d."userId"
        WHERE ${this.eligibilitySql(config)}
      ),
      metrics AS (
        SELECT t."driverId" AS did,
               COUNT(*)::int AS completed,
               COUNT(*) FILTER (WHERE ${peakFilter})::int AS peak
        FROM "Trip" t
        WHERE t."driverId" IS NOT NULL
          AND t."status" = 'COMPLETED'::"TripStatus"
          AND t."completedAt" IS NOT NULL
          ${this.windowSql(Prisma.sql`t."completedAt"`, window.from, window.to)}
        GROUP BY t."driverId"
      ),
      scored AS (
        SELECT e.id AS id,
               e.wilaya_id AS wilaya_id,
               e.rating AS rating,
               COALESCE(m.completed, 0) AS completed_trips,
               GREATEST(0, ROUND((
                 COALESCE(m.completed, 0) * ${coeffs.perCompletedTrip}
                 + COALESCE(m.peak, 0) * ${coeffs.perPeakTrip}
                 + CASE WHEN ${coeffs.ratingBonus} > 0 AND e.rating >= ${coeffs.ratingThreshold}
                        THEN ${coeffs.ratingBonus} ELSE 0 END
                 ${cancelExpr}
               ) * ${coeffs.campaignMultiplier}))::int AS score
        FROM eligible e
        LEFT JOIN metrics m ON m.did = e.id
        ${cancelJoin}
        WHERE COALESCE(m.completed, 0) >= ${config.eligibility.minCompletedTrips}
      ),
      ranked AS (
        SELECT s.id,
               s.wilaya_id,
               s.rating,
               s.completed_trips,
               s.score,
               ROW_NUMBER() OVER (ORDER BY ${orderBy})::int AS national_rank,
               COUNT(*) OVER ()::int AS national_total,
               MAX(s.score) OVER ()::int AS national_leader_score,
               LAG(s.score) OVER (ORDER BY ${orderBy})::int AS national_next_score,
               CASE WHEN s.wilaya_id IS NULL THEN NULL ELSE
                 ROW_NUMBER() OVER (PARTITION BY s.wilaya_id ORDER BY ${orderBy})::int
               END AS wilaya_rank,
               CASE WHEN s.wilaya_id IS NULL THEN NULL ELSE
                 COUNT(*) OVER (PARTITION BY s.wilaya_id)::int
               END AS wilaya_total,
               CASE WHEN s.wilaya_id IS NULL THEN NULL ELSE
                 MAX(s.score) OVER (PARTITION BY s.wilaya_id)::int
               END AS wilaya_leader_score,
               CASE WHEN s.wilaya_id IS NULL THEN NULL ELSE
                 LAG(s.score) OVER (PARTITION BY s.wilaya_id ORDER BY ${orderBy})::int
               END AS wilaya_next_score
        FROM scored s
      )`;
  }

  /**
   * مرتبة السائق نفسه — صف واحد، مهما كان ترتيبه (#7,842 مثلًا).
   * لا تحميل لأي صف آخر ولا فرز في Node.
   */
  private async queryMyPosition(
    driverId: string,
    config: LeaderboardConfig,
    coeffs: ScoreCoefficients,
    window: { from: Date | null; to: Date | null },
  ): Promise<MyPositionRow | null> {
    const rows = await this.prisma.$queryRaw<MyPositionRow[]>(Prisma.sql`
      ${this.rankedCte(config, coeffs, window)}
      SELECT r.score, r.rating, r.completed_trips,
             r.national_rank, r.national_total,
             r.national_leader_score, r.national_next_score,
             r.wilaya_rank, r.wilaya_total,
             r.wilaya_leader_score, r.wilaya_next_score
      FROM ranked r
      WHERE r.id = ${driverId}
      LIMIT 1`);
    return rows[0] ?? null;
  }

  /**
   * المتصدرون وطنيًا وداخل الولاية في استعلام واحد.
   * Top N من **كل** المؤهلين لا من عينة مقتطعة.
   */
  private async queryTopRows(
    config: LeaderboardConfig,
    coeffs: ScoreCoefficients,
    window: { from: Date | null; to: Date | null },
    wilayaId: string | null,
    limit: number,
  ): Promise<TopRow[]> {
    const wilayaClause = wilayaId
      ? Prisma.sql` OR (r.wilaya_id = ${wilayaId} AND r.wilaya_rank <= ${limit})`
      : Prisma.empty;

    return this.prisma.$queryRaw<TopRow[]>(Prisma.sql`
      ${this.rankedCte(config, coeffs, window)}
      SELECT r.id, r.score, r.rating, r.completed_trips,
             r.national_rank, r.wilaya_rank,
             u."name" AS name,
             u."avatarUrl" AS avatar_url,
             c."name" AS city_name,
             w."nameAr" AS wilaya_name_ar,
             w."nameFr" AS wilaya_name_fr,
             w."nameEn" AS wilaya_name_en
      FROM ranked r
      JOIN "Driver" d ON d."id" = r.id
      JOIN "User" u ON u."id" = d."userId"
      LEFT JOIN "City" c ON c."id" = d."cityId"
      LEFT JOIN "Wilaya" w ON w."id" = d."wilayaId"
      WHERE r.national_rank <= ${limit}${wilayaClause}
      ORDER BY r.national_rank ASC
      LIMIT ${limit * 2}`);
  }

  // ===================== التقديم =====================

  /**
   * يبني صفوف العرض.
   *
   * لا يُعاد من البيانات الشخصية إلا ما كان منشورًا أصلًا في هذه الشاشة:
   * الاسم والصورة والمدينة/الولاية والتقييم. لا هاتف، لا بريد، لا IBAN،
   * لا وثائق، لا أرقام مالية، ولا إحداثيات.
   */
  private async decorateRows(
    rows: TopRow[],
    scope: LeaderboardScope,
    myDriverId: string,
    unitKey: "TRIP" | "POINT",
  ) {
    return Promise.all(
      rows.map(async (r) => ({
        rank: scope === "NATIONAL" ? r.national_rank : (r.wilaya_rank ?? 0),
        driverId: r.id,
        name: r.name ?? null,
        photoUrl: await this.storage.resolveStoredUrl(
          r.avatar_url,
          STORED_MEDIA_READ_TTL_MINUTES,
        ),
        cityName: r.city_name ?? r.wilaya_name_ar ?? null,
        wilayaName: r.wilaya_name_ar
          ? {
              ar: r.wilaya_name_ar,
              fr: r.wilaya_name_fr,
              en: r.wilaya_name_en,
            }
          : null,
        score: r.score,
        scoreUnitKey: unitKey,
        rating: Number(r.rating),
        completedTrips: r.completed_trips,
        isMe: r.id === myDriverId,
      })),
    );
  }

  /** رد واضح عند تعطيل الميزة من اللوحة — لا أرقام مخترعة ولا قائمة مضلّلة. */
  private disabledPayload(
    period: LeaderboardPeriod,
    scope: LeaderboardScope,
    config: LeaderboardConfig,
    version: number | null,
    updatedAt: Date | null,
  ) {
    const empty = {
      rank: null,
      score: null,
      totalDrivers: null,
      pointsToNext: null,
      pointsToLeader: null,
      topDrivers: [] as unknown[],
    };
    return {
      enabled: false,
      scope: legacyScopeName(scope),
      scopeKey: scope,
      period: {
        period,
        from: null,
        to: null,
        computedAt: new Date().toISOString(),
        cachedTtlSec: config.cacheTtlSec,
        supported: ["WEEKLY", "MONTHLY", "ALL_TIME"],
      },
      scoring: {
        scoreUnitKey: "POINT" as const,
        configVersion: version,
        configUpdatedAt: updatedAt ? updatedAt.toISOString() : null,
        appliedRuleKeys: [] as string[],
      },
      national: { ...empty },
      wilaya: {
        ...empty,
        available: false,
        reason: "DISABLED",
        wilayaId: null,
      },
      me: null,
      profileLevel: null,
    };
  }

  private async requireDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, wilayaId: true, cityId: true, status: true },
    });
    if (!driver) throw new NotFoundException("ملف السائق غير موجود");
    return driver;
  }
}
