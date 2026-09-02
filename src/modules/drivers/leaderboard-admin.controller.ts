import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { LeaderboardService } from "./leaderboard.service";
import {
  DEFAULT_LEADERBOARD_CONFIG,
  LEADERBOARD_LIMITS,
  LEADERBOARD_PERIODS,
  LEADERBOARD_RULE_TYPES,
  LEADERBOARD_SETTING_GROUP,
  LEADERBOARD_SETTING_KEY,
  computeScore,
  normalizeLeaderboardConfig,
  resolveCoefficients,
  resolvePeriodWindow,
  resolveScoreUnitKey,
} from "./leaderboard.util";

/**
 * ===== واجهة اللوحة لقواعد الصدارة (قراءة فقط) =====
 *
 * لماذا لا توجد نقطة كتابة هنا؟
 * الإعداد مخزّن في جدول Setting تحت مفتاح واحد، والمشروع يملك أصلًا
 * مسار حكم كاملًا للإعدادات: مسودة → طلب مراجعة → موافقة/رفض → نشر
 * → SettingRevision + AuditLog، محميًا بـ STAFF + settings.manage.
 *
 * إضافة نقطة PUT خاصة بالصدارة كانت ستعني مسار تعديل ثانيًا يتجاوز
 * المراجعة والتدقيق، وهو بالتحديد ما يجب ألا يحدث في معادلة تحدد
 * ترتيب ألاف السائقين. لذلك الكتابة تمرّ عبر:
 *   POST /api/settings          { key: "driver.leaderboard", value: {...}, group: "driver" }
 *   POST /api/settings/driver.leaderboard/request-review
 *   POST /api/settings/change-requests/:id/approve
 * وهذه الواجهة تجيب على ما تحتاجه اللوحة فعلًا ولا توفره واجهة
 * الإعدادات العامة: ما القواعد الفعّالة الآن، وما المسموح،
 * وماذا ستفعل القيم المقترحة قبل حفظها.
 */
@Controller("drivers/leaderboard")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class LeaderboardAdminController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  /**
   * الإعداد الفعّال + المخطّط المسموح + الملاحظات.
   *
   * الملاحظات (warnings) مهمة للوضوح: إعداد فيه خطأ لا يُسقِط الشاشة
   * بل تُستبدل الحقول الفاسدة بالافتراضي، والمشرف يجب أن يرى ذلك
   * بدل أن يظن أن قاعدته مُطبّقة وهي مُسقطة.
   */
  @Get("config")
  async config() {
    const { config, warnings, version, updatedAt } =
      await this.leaderboard.loadConfig();
    const now = new Date();
    const coeffs = resolveCoefficients(config, now, null);
    return {
      settingKey: LEADERBOARD_SETTING_KEY,
      settingGroup: LEADERBOARD_SETTING_GROUP,
      /** الكتابة تمرّ من هنا فقط — بمراجعة وتدقيق ومراجعات محفوظة. */
      writeVia: {
        upsert: "POST /api/settings",
        requestReview: `POST /api/settings/${LEADERBOARD_SETTING_KEY}/request-review`,
        revisions: `GET /api/settings/${LEADERBOARD_SETTING_KEY}/revisions`,
      },
      configVersion: version,
      configUpdatedAt: updatedAt ? updatedAt.toISOString() : null,
      /** غير موجود في قاعدة البيانات بعد: المحرك يعمل بالافتراضي. */
      usingDefaults: version === null,
      effective: config,
      effectiveCoefficients: coeffs,
      scoreUnitKey: resolveScoreUnitKey(coeffs),
      warnings,
      defaults: DEFAULT_LEADERBOARD_CONFIG,
      schema: {
        periods: LEADERBOARD_PERIODS,
        ruleTypes: LEADERBOARD_RULE_TYPES,
        limits: LEADERBOARD_LIMITS,
        ruleFields: [
          "key",
          "type",
          "enabled",
          "value",
          "threshold",
          "startHour",
          "endHour",
          "startAt",
          "endAt",
          "scope",
          "wilayaId",
          "priority",
        ],
        eligibilityFields: [
          "requiredDriverStatus",
          "excludeTemporarilySuspended",
          "requireActiveUser",
          "minCompletedTrips",
          "minRating",
        ],
      },
    };
  }

  /**
   * معاينة قبل الحفظ: ماذا تُنتج القواعد الفعّالة لمقاييس مفترضة؟
   *
   * تحسب بنفس دالة computeScore المستخدمة في الاختبارات والمطابقة حرفيًا
   * للمعادلة المنفّدة في SQL، فلا تعرض رقمًا تقريبيًا مضللًا.
   * لا تمس قاعدة البيانات ولا تحفط شيئًا.
   */
  @Get("preview")
  async preview(
    @Query("completedTrips") completedTrips?: string,
    @Query("peakTrips") peakTrips?: string,
    @Query("cancellations") cancellations?: string,
    @Query("rating") rating?: string,
    @Query("wilayaId") wilayaId?: string,
  ) {
    const { config, warnings } = await this.leaderboard.loadConfig();
    const now = new Date();
    // wilayaId هنا مقبول لأن هذه معاينة مشرف (لمعرفة أثر قاعدة ولاية)
    // وليست ترتيب سائق: لا تُقرأ منها أي مرتبة ولا تُرجع بيانات أحد.
    const coeffs = resolveCoefficients(config, now, wilayaId ?? null);
    const metrics = {
      completedTrips: Math.max(0, Number(completedTrips) || 0),
      peakTrips: Math.max(0, Number(peakTrips) || 0),
      driverCancellations: Math.max(0, Number(cancellations) || 0),
      rating: Math.min(5, Math.max(0, Number(rating) || 0)),
    };
    return {
      period: resolvePeriodWindow(config.period, now, config.weekStartsOn),
      coefficients: coeffs,
      metrics,
      score: computeScore(coeffs, metrics),
      scoreUnitKey: resolveScoreUnitKey(coeffs),
      warnings,
    };
  }
}
