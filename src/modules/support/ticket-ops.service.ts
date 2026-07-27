import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import {
  computeSlaDueAtMs,
  escalationLevel,
  isBreached,
  isValidPriority,
  isValidResolutionCode,
  TicketPriority,
} from "./support-sla.util";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";

@Injectable()
export class TicketOpsService {
  private readonly logger = new Logger(TicketOpsService.name);

  constructor(
    private readonly cronLock: DistributedLockService,
    private readonly prisma: PrismaService,
  ) {}

  /** تعيين أولوية التذكرة وحساب موعد الـ SLA. */
  async setPriority(ticketId: string, priority: string) {
    if (!isValidPriority(priority)) {
      throw new BadRequestException("INVALID_PRIORITY");
    }
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    const slaDueAt = new Date(
      computeSlaDueAtMs(ticket.createdAt.getTime(), priority as TicketPriority),
    );
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { priority: priority as any, slaDueAt },
    });
  }

  /** إسناد التذكرة إلى عضو طاقم (staff ownership). */
  async assign(ticketId: string, assigneeId: string) {
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assigneeId, status: "PENDING" },
    });
  }

  /** تسجيل أوّل ردّ (لقياس SLA الاستجابة). */
  async markFirstResponse(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    if (ticket.firstResponseAt) return ticket;
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { firstResponseAt: new Date() },
    });
  }

  /** حلّ التذكرة برمز حلّ معيّن. */
  async resolve(ticketId: string, resolutionCode: string) {
    if (!isValidResolutionCode(resolutionCode)) {
      throw new BadRequestException("INVALID_RESOLUTION_CODE");
    }
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    const now = new Date();
    const breached = ticket.slaDueAt
      ? isBreached(ticket.slaDueAt.getTime(), now.getTime(), now.getTime())
      : false;
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: "RESOLVED",
        resolutionCode,
        resolvedAt: now,
        breached,
      },
    });
  }

  /** قائمة التذاكر المتجاوزة للـ SLA حاليًا. */
  async listBreaching() {
    const now = new Date();
    return this.prisma.supportTicket.findMany({
      where: {
        status: { in: ["OPEN", "PENDING"] },
        slaDueAt: { lt: now },
      },
      orderBy: { slaDueAt: "asc" },
      take: 100,
    });
  }

  /** مسح دوري: تحديث مستوى التصعيد ووسم التجاوز. */
  @Cron("0 */5 * * * *")
  async scanEscalations(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:support-escalations",
      () => this.scanEscalationsTask(),
      250000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async scanEscalationsTask(): Promise<{ scanned: number; updated: number }> {
    const now = Date.now();
    const open = await this.prisma.supportTicket.findMany({
      where: { status: { in: ["OPEN", "PENDING"] } },
      take: 200,
    });
    let escalated = 0;
    for (const t of open) {
      const priority = (t.priority ?? "NORMAL") as TicketPriority;
      const level = escalationLevel(t.createdAt.getTime(), now, priority);
      const breached = t.slaDueAt
        ? isBreached(t.slaDueAt.getTime(), now)
        : false;
      if (level !== t.escalationLevel || breached !== t.breached) {
        await this.prisma.supportTicket.update({
          where: { id: t.id },
          data: { escalationLevel: level, breached },
        });
        escalated++;
      }
    }
    if (escalated > 0) {
      this.logger.warn(`Support escalation scan updated ${escalated} tickets`);
    }
    return { scanned: open.length, updated: escalated };
  }
}
