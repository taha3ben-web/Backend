import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";
import {
  ARCHIVABLE_SETTLEMENT_STATUSES,
  ARCHIVABLE_TRIP_STATUSES,
  MAX_TRIP_ARCHIVE_BATCH_SIZE,
  TRIP_SNAPSHOT_VERSION,
  archiveAfterMonthsFromEnv,
  archiveBatchSizeFromEnv,
  archiveCutoff,
  buildTripSnapshot,
  isArchivable,
} from "./trip-archive.util";

/** نتيجة تشغيل واحد للأرشفة. */
export type ArchiveRunResult = {
  scanned: number;
  archived: number;
  skipped: number;
  eventsDeleted: number;
  messagesDeleted: number;
  dryRun: boolean;
  cutoff: string;
};

/**
 * أرشفة الرحلات المنتهية القديمة.
 *
 * لماذا: بعد TripTracking، أسرع جدولين نموًا هما TripEvent و TripMessage
 * (عشرات الأسطر لكل رحلة). بعد سنة تخرج فهارسهما من الذاكرة وتبدأ
 * كل قراءة من القرص — فتبطء شاشة "رحلاتي" والتقارير معًا.
 *
 * ما نفعله: نكتب نسخة باردة (JSONB) في TripArchive ثم نحذف أحداث
 * الرحلة ورسائلها من الجداول الساخنة داخل معاملة واحدة.
 *
 * ما لا نفعله: لا نحذف صف Trip نفسه أبدًا — Payment و Invoice و
 * DriverEarning تشير إليه، وحذفه يكسر الدفتر المالي وقابلية التدقيق.
 */
@Injectable()
export class TripArchiveService {
  private readonly logger = new Logger("TripArchive");

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronLock: DistributedLockService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private env(key: string): string | undefined {
    return this.config?.get<string>(key) ?? process.env[key];
  }

  private afterMonths(): number {
    return archiveAfterMonthsFromEnv(this.env("TRIP_ARCHIVE_AFTER_MONTHS"));
  }

  private batchSize(): number {
    return archiveBatchSizeFromEnv(this.env("TRIP_ARCHIVE_BATCH_SIZE"));
  }

  /** المهمة المجدولة معطّلة افتراضيًا: الحذف لا يُفعّل دون قرار صريح. */
  private enabled(): boolean {
    return String(this.env("TRIP_ARCHIVE_ENABLED") ?? "false") === "true";
  }

  /** مقاييس سريعة للوحة الإدارة قبل تشغيل أي حذف. */
  async stats(now: Date = new Date()): Promise<{
    cutoff: string;
    afterMonths: number;
    batchSize: number;
    enabled: boolean;
    archivedTrips: number;
    pendingTrips: number;
  }> {
    const afterMonths = this.afterMonths();
    const cutoff = archiveCutoff(now, afterMonths);
    const [archivedTrips, pendingTrips] = await Promise.all([
      this.prisma.tripArchive.count(),
      this.prisma.trip.count({ where: this.candidateWhere(cutoff) }),
    ]);
    return {
      cutoff: cutoff.toISOString(),
      afterMonths,
      batchSize: this.batchSize(),
      enabled: this.enabled(),
      archivedTrips,
      pendingTrips,
    };
  }

  /** شرط المرشّحين في قاعدة البيانات — التمحيص النهائي يتم في isArchivable. */
  private candidateWhere(cutoff: Date): Prisma.TripWhereInput {
    return {
      archivedAt: null,
      status: { in: [...ARCHIVABLE_TRIP_STATUSES] as never },
      settlementStatus: { in: [...ARCHIVABLE_SETTLEMENT_STATUSES] as never },
      OR: [
        { completedAt: { lt: cutoff } },
        { completedAt: null, createdAt: { lt: cutoff } },
      ],
    };
  }

  /** يوميًا الساعة 03:50 — بعد مهمة أقسام التتبّع حتى لا يتزاحما على القرص. */
  @Cron("0 50 3 * * *")
  async scheduled(): Promise<void> {
    if (!this.enabled()) return;
    await this.cronLock.runExclusive(
      "cron:trip-archive",
      () => this.runOnce({}),
      600000,
    );
  }

  /**
   * دفعة أرشفة واحدة. خاملة التكرار: الرحلة المؤرشفة تخرج من الشرط
   * بعد تعيين archivedAt، فإعادة التشغيل لا تكرر العمل ولا تفقد شيئًا.
   */
  async runOnce(options: {
    limit?: number;
    dryRun?: boolean;
    now?: Date;
  }): Promise<ArchiveRunResult> {
    const now = options.now ?? new Date();
    const dryRun = options.dryRun ?? false;
    const cutoff = archiveCutoff(now, this.afterMonths());
    const limit = Math.min(
      MAX_TRIP_ARCHIVE_BATCH_SIZE,
      Math.max(1, options.limit ?? this.batchSize()),
    );

    const candidates = await this.prisma.trip.findMany({
      where: this.candidateWhere(cutoff),
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        _count: { select: { lostItems: true, complaints: true } },
      },
    });

    const result: ArchiveRunResult = {
      scanned: candidates.length,
      archived: 0,
      skipped: 0,
      eventsDeleted: 0,
      messagesDeleted: 0,
      dryRun,
      cutoff: cutoff.toISOString(),
    };

    for (const candidate of candidates) {
      const { _count: counts, ...trip } = candidate as typeof candidate & {
        _count: { lostItems: number; complaints: number };
      };
      const eligible = isArchivable(
        {
          id: trip.id,
          status: String(trip.status),
          settlementStatus: String(trip.settlementStatus),
          completedAt: trip.completedAt ?? null,
          createdAt: trip.createdAt,
          archivedAt: trip.archivedAt ?? null,
          openLostItems: counts.lostItems,
          openComplaints: counts.complaints,
        },
        cutoff,
      );
      if (!eligible) {
        result.skipped += 1;
        continue;
      }
      if (dryRun) {
        result.archived += 1;
        continue;
      }
      try {
        const moved = await this.archiveTrip(trip.id, trip);
        result.archived += 1;
        result.eventsDeleted += moved.events;
        result.messagesDeleted += moved.messages;
      } catch (error) {
        result.skipped += 1;
        this.logger.error(
          `تعذر أرشفة الرحلة ${trip.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (result.archived > 0) {
      this.logger.log(
        `أرشفة الرحلات — مفحوص: ${result.scanned}، مؤرشف: ${result.archived}، أحداث محذوفة: ${result.eventsDeleted}${
          dryRun ? " (تجريبي)" : ""
        }`,
      );
    }
    return result;
  }

  /** ينقل رحلة واحدة إلى الأرشيف داخل معاملة واحدة (كلّ أو لا شيء). */
  private async archiveTrip(
    tripId: string,
    trip: Record<string, unknown>,
  ): Promise<{ events: number; messages: number }> {
    const [events, messages, trackingCount] = await Promise.all([
      this.prisma.tripEvent.findMany({
        where: { tripId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.tripMessage.findMany({
        where: { tripId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.tripTracking.count({ where: { tripId } }),
    ]);

    const snapshot = buildTripSnapshot({
      trip: JSON.parse(JSON.stringify(trip)) as Record<string, unknown>,
      events: events.map((event) => ({
        type: event.type,
        actor: String(event.actor),
        createdAt: event.createdAt,
        meta: event.meta ?? undefined,
      })),
      messages: messages.map((message) => ({
        senderId: message.senderId,
        body: message.body,
        createdAt: message.createdAt,
      })),
      trackingCount,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.tripArchive.upsert({
        where: { tripId },
        update: {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotVersion: TRIP_SNAPSHOT_VERSION,
          eventCount: snapshot.counts.events,
          messageCount: snapshot.counts.messages,
          trackingCount: snapshot.counts.tracking,
        },
        create: {
          tripId,
          passengerId: String(trip.passengerId),
          driverId: (trip.driverId as string | null) ?? null,
          status: trip.status as never,
          currency: String(trip.currency),
          fare: (trip.fare as never) ?? null,
          completedAt: (trip.completedAt as Date | null) ?? null,
          tripCreatedAt: trip.createdAt as Date,
          eventCount: snapshot.counts.events,
          messageCount: snapshot.counts.messages,
          trackingCount: snapshot.counts.tracking,
          snapshotVersion: TRIP_SNAPSHOT_VERSION,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.tripEvent.deleteMany({ where: { tripId } });
      await tx.tripMessage.deleteMany({ where: { tripId } });
      await tx.trip.update({
        where: { id: tripId },
        data: { archivedAt: new Date() },
      });
    });

    return { events: events.length, messages: messages.length };
  }

  /** يقرأ النسخة الباردة لرحلة مؤرشفة (للدعم والتدقيق). */
  async snapshotFor(tripId: string) {
    return this.prisma.tripArchive.findUnique({ where: { tripId } });
  }
}
