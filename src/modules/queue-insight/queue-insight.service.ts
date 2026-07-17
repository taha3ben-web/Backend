import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../../common/infra/outbox.service";
import {
  classifyQueue,
  clampRetentionDays,
  QUEUE_DEFAULT_RETENTION_DAYS,
  QueueInsight,
  QueueStatusCounts,
  retentionCutoff,
} from "./queue-insight.util";

type StatusGroupRow = { status: string; _count: { _all: number } };
type NameStatusGroupRow = {
  name: string;
  status: string;
  _count: { _all: number };
};

export interface QueueBacklogByName {
  name: string;
  pending: number;
  failed: number;
  delivered: number;
  dead: number;
  backlog: number;
  total: number;
}

function emptyCounts(): QueueStatusCounts {
  return { pending: 0, failed: 0, delivered: 0, dead: 0 };
}

function applyStatusCount(
  counts: QueueStatusCounts,
  status: string,
  count: number,
): void {
  switch (status) {
    case "PENDING":
      counts.pending += count;
      break;
    case "FAILED":
      counts.failed += count;
      break;
    case "DELIVERED":
      counts.delivered += count;
      break;
    case "DEAD":
      counts.dead += count;
      break;
    default:
      break;
  }
}

/**
 * خدمة رؤية وصيانة الطابور الخلفي (Outbox):
 * تضيف طبقة مراقبة وصيانة فوق البنية القائمة دون لمس مسار enqueue/relay
 * الحرج: عمق التراكم وتقادمه، وتفصيل حسب اسم الحدث، وإعادة جدولة جماعية
 * لـ DLQ، وتنظيف سجلات DELIVERED المتراكمة (retention). لا منطق تسعير/خصم.
 */
@Injectable()
export class QueueInsightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** لقطة صحّية للطابور: عدّادات الحالات + تقادم أقدم عنصر معلّق + شدّة مشتقّة. */
  async insight(): Promise<QueueInsight & { generatedAt: string }> {
    const grouped = (await this.prisma.outboxEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
    })) as unknown as StatusGroupRow[];

    const counts = emptyCounts();
    for (const row of grouped) {
      applyStatusCount(counts, row.status, row._count._all);
    }

    const oldest = await this.prisma.outboxEvent.findFirst({
      where: { status: { in: ["PENDING", "FAILED"] } },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    });

    const now = new Date();
    const oldestPendingAgeMs = oldest
      ? Math.max(0, now.getTime() - oldest.availableAt.getTime())
      : null;

    const insight = classifyQueue({ counts, oldestPendingAgeMs });
    return { ...insight, generatedAt: now.toISOString() };
  }

  /** تفصيل الطابور حسب اسم الحدث (لتحديد الأنواع الأكثر تراكمًا/فشلًا). */
  async backlogByName(limit = 20): Promise<QueueBacklogByName[]> {
    const grouped = (await this.prisma.outboxEvent.groupBy({
      by: ["name", "status"],
      _count: { _all: true },
    })) as unknown as NameStatusGroupRow[];

    const byName = new Map<string, QueueStatusCounts>();
    for (const row of grouped) {
      const current = byName.get(row.name) ?? emptyCounts();
      applyStatusCount(current, row.status, row._count._all);
      byName.set(row.name, current);
    }

    const rows: QueueBacklogByName[] = [];
    for (const [name, counts] of byName.entries()) {
      const backlog = counts.pending + counts.failed;
      rows.push({
        name,
        pending: counts.pending,
        failed: counts.failed,
        delivered: counts.delivered,
        dead: counts.dead,
        backlog,
        total:
          counts.pending + counts.failed + counts.delivered + counts.dead,
      });
    }

    rows.sort((a, b) => {
      const activeA = a.backlog + a.dead;
      const activeB = b.backlog + b.dead;
      if (activeB !== activeA) return activeB - activeA;
      return b.total - a.total;
    });

    return rows.slice(0, limit);
  }

  /**
   * تنظيف (housekeeping): يحذف سجلات DELIVERED المُسلَّمة قبل لحظة القطع.
   * آمن: لا يمسّ إلا الأحداث المكتملة بالفعل (لا يؤثّر على at-least-once).
   */
  async purgeDelivered(
    olderThanDays?: number,
  ): Promise<{ deleted: number; cutoff: string; olderThanDays: number }> {
    const days = clampRetentionDays(
      olderThanDays ?? QUEUE_DEFAULT_RETENTION_DAYS,
    );
    const cutoff = retentionCutoff(new Date(), days);
    const result = await this.prisma.outboxEvent.deleteMany({
      where: { status: "DELIVERED", deliveredAt: { lt: cutoff } },
    });
    return {
      deleted: result.count,
      cutoff: cutoff.toISOString(),
      olderThanDays: days,
    };
  }

  /**
   * إعادة جدولة جماعية لدفعة من رسائل DLQ (أقدمها أولًا) — تصفير المحاولات.
   * تُكمّل إعادة المحاولة الفردية الموجودة في مركز العمليات دون تكرارها.
   */
  async retryAllDeadLetters(limit = 100): Promise<{ requeued: number }> {
    const dead = await this.prisma.outboxEvent.findMany({
      where: { status: "DEAD" },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    if (dead.length === 0) return { requeued: 0 };

    const ids = dead.map((item) => item.id);
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
      },
    });
    return { requeued: result.count };
  }

  /** قائمة رسائل DLQ (يعيد استخدام خدمة الـ Outbox القائمة). */
  listDeadLetters(limit = 50) {
    return this.outbox.listDeadLetters(limit);
  }
}
