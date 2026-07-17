import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EventBusService } from "./event-bus.service";
import { nextOutboxState, OUTBOX_MAX_ATTEMPTS } from "./outbox.util";

export interface EnqueueOptions {
  /** مفتاح إزالة التكرار (فريد) — يمنع إدخال نفس الحدث مرتين. */
  dedupeKey?: string;
  maxAttempts?: number;
  availableAt?: Date;
}

/**
 * صندوق صادر دائم (Transactional Outbox):
 * - `enqueue` يُكتب الحدث داخل نفس معاملة العمل — فإمّا يُحفظ الاثنان معًا أو لا شيء.
 * - `relayDueEvents` (cron) يُسلّم الأحداث المستحقة عبر ناقل الأحداث مع إعادة
 *   محاولة أسّية؛ وبعد بلوغ الحد الأقصى تنتقل إلى DLQ (حالة DEAD).
 *
 * التسليم at-least-once: يجب أن يكون المستهلكون idempotent.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger("Outbox");
  private relaying = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
  ) {}

  /**
   * يُدرج حدثًا داخل معاملة قائمة (النمط الموصى به للأحداث الحرجة).
   * مرّر نفس `tx` الخاص بعملية العمل (مثل settleTrip) لضمان الذرية.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    name: string,
    payload: unknown,
    options: EnqueueOptions = {},
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        name,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        dedupeKey: options.dedupeKey,
        maxAttempts: options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS,
        availableAt: options.availableAt ?? new Date(),
      },
    });
  }

  /**
   * يُدرج حدثًا خارج أي معاملة (يفتح معاملته). يتجاهل التكرار
   * بصمت إذا وُجد `dedupeKey` مطابق (P2002).
   */
  async enqueueStandalone(
    name: string,
    payload: unknown,
    options: EnqueueOptions = {},
  ): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({
        data: {
          name,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          dedupeKey: options.dedupeKey,
          maxAttempts: options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS,
          availableAt: options.availableAt ?? new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // حدث مكرر بنفس dedupeKey — تجاهل (idempotent).
        return;
      }
      throw error;
    }
  }

  /** يُشغّل دوريًا: يلتقط الأحداث المستحقة ويحاول تسليمها. */
  @Cron("*/15 * * * * *")
  async relayDueEvents(): Promise<void> {
    if (this.relaying) return; // منع تداخل دورتين.
    this.relaying = true;
    try {
      const now = new Date();
      const due = await this.prisma.outboxEvent.findMany({
        where: {
          status: { in: ["PENDING", "FAILED"] },
          availableAt: { lte: now },
        },
        orderBy: { availableAt: "asc" },
        take: 50,
      });
      for (const event of due) {
        await this.dispatch(event);
      }
    } catch (error) {
      this.logger.warn(
        `outbox relay error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.relaying = false;
    }
  }

  private async dispatch(event: {
    id: string;
    name: string;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    let success = false;
    let error: string | null = null;
    try {
      this.events.emit(event.name, event.payload);
      success = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const transition = nextOutboxState({
      success,
      attempts: event.attempts,
      maxAttempts: event.maxAttempts,
      error,
    });

    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: transition.status,
        attempts: transition.attempts,
        availableAt: transition.availableAt,
        lastError: transition.lastError,
        deliveredAt: transition.deliveredAt,
      },
    });

    if (transition.status === "DEAD") {
      this.logger.error(
        `outbox event ${event.id} (${event.name}) moved to DLQ after ${transition.attempts} attempts: ${transition.lastError}`,
      );
    }
  }

  // ---------- إدارة DLQ (للوحة التحكم التشغيلية) ----------

  /** قائمة الأحداث المُرسلة إلى DLQ. */
  async listDeadLetters(limit = 100) {
    return this.prisma.outboxEvent.findMany({
      where: { status: "DEAD" },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  /** إحصاءات مختصرة للحالات (للوحة). */
  async stats(): Promise<Record<string, number>> {
    const grouped = await this.prisma.outboxEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const result: Record<string, number> = {
      PENDING: 0,
      DELIVERED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const row of grouped as Array<{
      status: string;
      _count: { _all: number };
    }>) {
      result[row.status] = row._count._all;
    }
    return result;
  }

  /** إعادة جدولة حدث من DLQ لمحاولة جديدة (تصفير المحاولات). */
  async retryDeadLetter(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
      },
    });
  }
}
