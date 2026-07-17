import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../rbac/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

/**
 * Stage 65 — نظام عقوبات إلغاء السائق (كما في الشركات الكبرى).
 *
 * يحسب عدد إلغاءات السائق ضمن نافذة متدحرجة ويطبّق عقوبات تصاعدية:
 *   تحذير → تعليق مؤقّت (يُرفع تلقائيًا) → حظر (يحتاج رفعًا يدويًا).
 * الإنفاذ تلقائي: محرّك المطابقة يقبل APPROVED فقط، فالمعلّق/المحظور لا يصله أي طلب.
 * العتبات والمدد قابلة للضبط من لوحة التحكم عبر مفتاح الإعدادات.
 */

const SANCTIONS_KEY = "trips.driverCancellationSanctions";

interface SanctionsConfig {
  enabled: boolean;
  windowDays: number;
  warnThreshold: number;
  suspendThreshold: number;
  suspendHours: number;
  banThreshold: number;
}

const DEFAULT_SANCTIONS_CONFIG: SanctionsConfig = {
  enabled: false,
  windowDays: 7,
  warnThreshold: 3,
  suspendThreshold: 5,
  suspendHours: 24,
  banThreshold: 10,
};

type SanctionLevel = "WARNING" | "SUSPENSION" | "BAN";

function sanctionRank(level: string): number {
  switch (level) {
    case "BAN":
      return 3;
    case "SUSPENSION":
      return 2;
    case "WARNING":
      return 1;
    default:
      return 0;
  }
}

@Injectable()
export class DriverSanctionsService {
  private readonly logger = new Logger(DriverSanctionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private toPositiveInt(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
  }

  /** يقرأ إعدادات العقوبات من مفتاح الإعدادات (مع قيم افتراضية آمنة). */
  async loadConfig(): Promise<SanctionsConfig> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: SANCTIONS_KEY },
      });
      const raw = (setting?.publishedValue ?? setting?.value) as unknown as
        | Partial<SanctionsConfig>
        | null;
      if (!raw || typeof raw !== "object") return DEFAULT_SANCTIONS_CONFIG;
      return {
        enabled: Boolean(raw.enabled),
        windowDays:
          this.toPositiveInt(
            raw.windowDays,
            DEFAULT_SANCTIONS_CONFIG.windowDays,
          ) || DEFAULT_SANCTIONS_CONFIG.windowDays,
        warnThreshold: this.toPositiveInt(
          raw.warnThreshold,
          DEFAULT_SANCTIONS_CONFIG.warnThreshold,
        ),
        suspendThreshold: this.toPositiveInt(
          raw.suspendThreshold,
          DEFAULT_SANCTIONS_CONFIG.suspendThreshold,
        ),
        suspendHours:
          this.toPositiveInt(
            raw.suspendHours,
            DEFAULT_SANCTIONS_CONFIG.suspendHours,
          ) || DEFAULT_SANCTIONS_CONFIG.suspendHours,
        banThreshold: this.toPositiveInt(
          raw.banThreshold,
          DEFAULT_SANCTIONS_CONFIG.banThreshold,
        ),
      };
    } catch {
      return DEFAULT_SANCTIONS_CONFIG;
    }
  }

  /**
   * مهمة دورية: ترفع التعليقات المنتهية ثم تقيّم إلغاءات السائقين.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async evaluateDriverCancellationSanctions(): Promise<void> {
    try {
      await this.restoreExpiredSuspensions();
    } catch (err) {
      this.logger.warn(`تعذّر رفع التعليقات المنتهية: ${String(err)}`);
    }

    const config = await this.loadConfig();
    if (!config.enabled) return;

    const now = new Date();
    const windowStart = new Date(
      now.getTime() - config.windowDays * 24 * 60 * 60 * 1000,
    );

    let candidates: Array<{ driverId: string; count: number }> = [];
    try {
      const grouped = await this.prisma.trip.groupBy({
        by: ["driverId"],
        where: {
          driverId: { not: null },
          status: "CANCELLED",
          cancelledBy: "DRIVER",
          updatedAt: { gte: windowStart },
        },
        _count: { _all: true },
      });
      candidates = grouped
        .filter((g) => Boolean(g.driverId))
        .map((g) => ({
          driverId: g.driverId as string,
          count: g._count._all,
        }));
    } catch (err) {
      this.logger.warn(`تعذّر تجميع إلغاءات السائقين: ${String(err)}`);
      return;
    }

    for (const { driverId, count } of candidates) {
      try {
        await this.applySanctionIfNeeded(
          driverId,
          count,
          config,
          windowStart,
          now,
        );
      } catch (err) {
        this.logger.warn(
          `تعذّر تطبيق عقوبة للسائق ${driverId}: ${String(err)}`,
        );
      }
    }
  }

  /** يرجع السائقين المعلّقين مؤقتًا إلى APPROVED بعد انتهاء المدة. */
  private async restoreExpiredSuspensions(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.driver.findMany({
      where: {
        status: "SUSPENDED",
        suspendedUntil: { not: null, lte: now },
      },
      select: { id: true },
    });
    for (const driver of expired) {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { status: "APPROVED", suspendedUntil: null },
      });
      await this.audit.record({
        actorId: null,
        action: "driver.sanction.auto_restore",
        entity: "Driver",
        entityId: driver.id,
        meta: { reason: "suspension expired" },
      });
    }
  }

  /** يحدّد المستوى المستحق ويطبّقه إذا لم تصدر عقوبة مماثلة/أعلى ضمن النافذة. */
  private async applySanctionIfNeeded(
    driverId: string,
    count: number,
    config: SanctionsConfig,
    windowStart: Date,
    now: Date,
  ): Promise<void> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, userId: true, status: true, availability: true },
    });
    if (!driver) return;
    // لا تُعاقِب سائقًا غير نشط (معلّق/محظور/قيد المراجعة).
    if (driver.status !== "APPROVED") return;

    let level: SanctionLevel | null = null;
    if (config.banThreshold > 0 && count >= config.banThreshold) level = "BAN";
    else if (config.suspendThreshold > 0 && count >= config.suspendThreshold)
      level = "SUSPENSION";
    else if (config.warnThreshold > 0 && count >= config.warnThreshold)
      level = "WARNING";
    if (!level) return;

    // عدم التكرار: تخطَّ إذا صدرت عقوبة بنفس المستوى أو أعلى ضمن النافذة.
    const existing = await this.prisma.driverSanction.findFirst({
      where: { driverId, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
    });
    if (existing && sanctionRank(existing.level) >= sanctionRank(level)) return;

    const suspendedUntil =
      level === "SUSPENSION"
        ? new Date(now.getTime() + config.suspendHours * 60 * 60 * 1000)
        : null;
    // لا نُرغم الخروج إلا إذا كان متصلًا (تجنّب إفساد حالة ON_TRIP).
    const forceOffline = driver.availability === "ONLINE";

    await this.prisma.$transaction(async (tx) => {
      await tx.driverSanction.create({
        data: {
          driverId,
          level,
          cancellationCount: count,
          windowStart,
          windowEnd: now,
          suspendedUntil,
          reason: `driver cancellations=${count} within ${config.windowDays}d`,
        },
      });

      if (level === "WARNING") {
        await tx.driver.update({
          where: { id: driverId },
          data: { lastSanctionAt: now },
        });
        return;
      }

      await tx.driver.update({
        where: { id: driverId },
        data: {
          status: level === "BAN" ? "BANNED" : "SUSPENDED",
          suspendedUntil,
          lastSanctionAt: now,
          cancellationStrikes: { increment: 1 },
          ...(forceOffline ? { availability: "OFFLINE" as const } : {}),
        },
      });
    });

    await this.audit.record({
      actorId: null,
      action: `driver.sanction.${level.toLowerCase()}`,
      entity: "Driver",
      entityId: driverId,
      meta: {
        level,
        cancellationCount: count,
        windowDays: config.windowDays,
        suspendedUntil: suspendedUntil ? suspendedUntil.toISOString() : null,
      },
    });

    // إشعار Push للسائق عند التعليق/الحظر (أفضل-جهد؛ الفشل لا يكسر العقوبة).
    if (level !== "WARNING") {
      const untilText = suspendedUntil
        ? ` حتى ${suspendedUntil.toISOString()}`
        : "";
      void this.notifications
        .notifyUser(
          driver.userId,
          level === "BAN" ? "تم حظر حسابك" : "تم تعليق حسابك مؤقتًا",
          level === "BAN"
            ? "تم حظر حسابك بسبب كثرة إلغاء الرحلات. يُرجى التواصل مع الدعم."
            : `تم تعليق حسابك مؤقتًا بسبب كثرة إلغاء الرحلات${untilText}.`,
          "PUSH",
          { kind: "driver_sanction", level, cancellationCount: count },
        )
        .catch((err: unknown) =>
          this.logger.warn(
            `فشل إرسال إشعار العقوبة للسائق ${driverId}: ${String(err)}`,
          ),
        );
    }
  }

  // ===== واجهات الإدارة (لوحة التحكم) =====

  /** سجل العقوبات الأحدث (مع بيانات السائق). */
  async listSanctions(q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driverSanction.findMany({
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          driver: {
            select: {
              id: true,
              status: true,
              suspendedUntil: true,
              cancellationStrikes: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.driverSanction.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** قائمة السائقين المعلّقين/المحظورين حاليًا. */
  async listSuspended() {
    return this.prisma.driver.findMany({
      where: { status: { in: ["SUSPENDED", "BANNED"] } },
      orderBy: { lastSanctionAt: "desc" },
      select: {
        id: true,
        status: true,
        suspendedUntil: true,
        cancellationStrikes: true,
        lastSanctionAt: true,
        user: { select: { name: true, phone: true } },
      },
    });
  }

  /** رفع التعليق/الحظر يدويًا (إجراء حسّاس — مدقّق). */
  async liftSuspension(driverId: string, actorId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, status: true },
    });
    if (!driver) throw new NotFoundException("Driver not found");
    const updated = await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        status: "APPROVED",
        suspendedUntil: null,
        cancellationStrikes: 0,
      },
    });
    await this.audit.record({
      actorId,
      action: "driver.sanction.manual_lift",
      entity: "Driver",
      entityId: driverId,
      meta: { previousStatus: driver.status },
    });
    return { id: updated.id, status: updated.status };
  }

  /** الإعدادات الفعّالة للعقوبات (للعرض في اللوحة). */
  async getConfig(): Promise<SanctionsConfig> {
    return this.loadConfig();
  }

  /**
   * حالة العقوبة الحالية للسائق (لتطبيق السائق): الحالة، مدة التعليق،
   * عدد الإلغاءات ضمن النافذة، والمتبقّي قبل كل مستوى، وآخر عقوبة.
   */
  async getDriverSanctionStatus(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        status: true,
        suspendedUntil: true,
        cancellationStrikes: true,
        lastSanctionAt: true,
      },
    });
    if (!driver) throw new NotFoundException("Driver not found");

    const config = await this.loadConfig();
    const now = new Date();
    const windowStart = new Date(
      now.getTime() - config.windowDays * 24 * 60 * 60 * 1000,
    );

    let cancellationCount = 0;
    try {
      cancellationCount = await this.prisma.trip.count({
        where: {
          driverId,
          status: "CANCELLED",
          cancelledBy: "DRIVER",
          updatedAt: { gte: windowStart },
        },
      });
    } catch {
      cancellationCount = 0;
    }

    const lastSanction = await this.prisma.driverSanction.findFirst({
      where: { driverId },
      orderBy: { createdAt: "desc" },
      select: {
        level: true,
        cancellationCount: true,
        suspendedUntil: true,
        createdAt: true,
      },
    });

    const remaining = (threshold: number): number | null =>
      threshold > 0 ? Math.max(0, threshold - cancellationCount) : null;

    return {
      status: driver.status,
      suspendedUntil: driver.suspendedUntil,
      cancellationStrikes: driver.cancellationStrikes,
      lastSanctionAt: driver.lastSanctionAt,
      enabled: config.enabled,
      window: {
        days: config.windowDays,
        since: windowStart,
        cancellationCount,
      },
      thresholds: {
        warn: config.warnThreshold,
        suspend: config.suspendThreshold,
        ban: config.banThreshold,
        suspendHours: config.suspendHours,
      },
      remaining: {
        toWarning: remaining(config.warnThreshold),
        toSuspension: remaining(config.suspendThreshold),
        toBan: remaining(config.banThreshold),
      },
      lastSanction,
    };
  }
}
