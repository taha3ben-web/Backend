import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";
import {
  PARTITION_LOOKAHEAD_MONTHS,
  isTrackingPartition,
  partitionsToDrop,
  retentionMonthsFromEnv,
  shiftMonth,
  trackingPartitionName,
} from "./tracking-retention.util";

/**
 * صيانة أقسام جدول التتبّع (TripTracking).
 *
 * الجدول مُقسّم شهريًا في قاعدة البيانات. هذه المهمة تقوم بأمرين:
 * 1. إنشاء أقسام الأشهر القادمة مسبقًا — دونها تذهب النقاط إلى القسم
 *    الافتراضي ويفقد التقسيم فائدته.
 * 2. حذف الأقسام القديمة بـ DROP TABLE (عملية فورية) بدل DELETE الذي يولّد
 *    تضخّمًا ويقفل الجدول دقائق.
 *
 * الأمان: كل اسم يُمرّر إلى SQL ديناميكي يُولّد من تاريخ أو يُفحص بتعبير
 * نمطي صارم أولًا؛ لا يصل أي مدخل مستخدم إلى هنا.
 */
@Injectable()
export class TrackingRetentionService {
  private readonly logger = new Logger("TrackingRetention");

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronLock: DistributedLockService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private retentionMonths(): number {
    return retentionMonthsFromEnv(
      this.config?.get<string>("TRIP_TRACKING_RETENTION_MONTHS") ??
        process.env.TRIP_TRACKING_RETENTION_MONTHS,
    );
  }

  /** يوميًا الساعة 03:20 — وقت منخفض الحمل. */
  @Cron("0 20 3 * * *")
  async maintain(): Promise<void> {
    await this.cronLock.runExclusive(
      "cron:tracking-partitions",
      () => this.maintainTask(),
      600000,
    );
  }

  /** المنطق الفعلي بعد الحصول على القفل. */
  async maintainTask(): Promise<{ created: string[]; dropped: string[] }> {
    const created = await this.ensureUpcomingPartitions();
    const dropped = await this.dropExpiredPartitions();
    if (created.length || dropped.length) {
      this.logger.log(
        `أقسام التتبّع — أُنشئ: ${created.length}، حُذف: ${dropped.length}`,
      );
    }
    return { created, dropped };
  }

  /** يضمن وجود قسم الشهر الحالي والأشهر القادمة. */
  async ensureUpcomingPartitions(now: Date = new Date()): Promise<string[]> {
    const created: string[] = [];
    for (let i = 0; i <= PARTITION_LOOKAHEAD_MONTHS; i += 1) {
      const month = shiftMonth(now, i);
      const name = trackingPartitionName(month);
      try {
        // الدالة معرّفة في مايغريشن 20260727065000_trip_tracking_partitions
        // وهي خاملة التكرار (تتجاهل القسم الموجود).
        await this.prisma
          .$queryRaw`SELECT flamingo_ensure_tracking_partition(${month.toISOString().slice(0, 10)}::date)`;
        created.push(name);
      } catch (error) {
        this.logger.error(
          `تعذر إنشاء قسم ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return created;
  }

  /** يحذف أقسام الأشهر التي تجاوزت مدة الاحتفاظ. */
  async dropExpiredPartitions(now: Date = new Date()): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT c.relname AS tablename
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'TripTracking'
    `;
    const names = rows.map((r) => r.tablename);
    const doomed = partitionsToDrop(names, now, this.retentionMonths());

    const dropped: string[] = [];
    for (const name of doomed) {
      // دفاع مزدوج: لا ننفّذ DROP إلا على اسم يطابق نمط أقسام التتبّع.
      if (!isTrackingPartition(name)) continue;
      try {
        await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`);
        dropped.push(name);
        this.logger.log(`حُذف قسم تتبّع منتهٍ: ${name}`);
      } catch (error) {
        this.logger.error(
          `تعذر حذف القسم ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return dropped;
  }
}
