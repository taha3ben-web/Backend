import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TicketStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AddTicketMessageDto, CreateTicketDto } from "./dto/support.dto";

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  /** المستخدم يفتح تذكرة دعم مع أول رسالة */
  async createTicket(userId: string, dto: CreateTicketDto) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        category: dto.category,
        status: "OPEN",
        messages: { create: { senderId: userId, body: dto.message } },
      },
      include: { messages: true },
    });
  }

  /** إضافة رسالة للمحادثة (من المستخدم أو الدعم) */
  async addMessage(
    ticketId: string,
    senderId: string,
    isStaff: boolean,
    dto: AddTicketMessageDto,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException("التذكرة غير موجودة");
    if (!isStaff && ticket.userId !== senderId) {
      throw new ForbiddenException("غير مسموح");
    }
    if (ticket.status === "CLOSED") {
      throw new BadRequestException("التذكرة مغلقة");
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { ticketId, senderId, body: dto.body },
      }),
      // رد الدعم يحوّلها إلى PENDING للمستخدم، ورد المستخدم يعيدها OPEN
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: isStaff ? "PENDING" : "OPEN" },
      }),
    ]);
    return message;
  }

  /** تذكرة واحدة مع كامل المحادثة */
  async getTicket(ticketId: string, userId: string, isStaff: boolean) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { name: true, phone: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { sender: { select: { name: true, type: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException("التذكرة غير موجودة");
    if (!isStaff && ticket.userId !== userId) {
      throw new ForbiddenException("غير مسموح");
    }
    return ticket;
  }

  /** تذاكر المستخدم الحالي */
  async myTickets(userId: string, q: PaginationDto) {
    const where: Prisma.SupportTicketWhereInput = { userId };
    return this.paginate(where, q);
  }

  /** كل التذاكر (للدعم) مع فلترة الحالة */
  async allTickets(q: PaginationDto, status?: TicketStatus) {
    const where: Prisma.SupportTicketWhereInput = status ? { status } : {};
    return this.paginate(where, q);
  }

  /** تغيير حالة التذكرة (إغلاق/حل/إعادة فتح) */
  async updateStatus(ticketId: string, status: TicketStatus) {
    await this.getTicketOrThrow(ticketId);
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status },
    });
  }

  private async getTicketOrThrow(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException("التذكرة غير موجودة");
    return ticket;
  }

  private async paginate(
    where: Prisma.SupportTicketWhereInput,
    q: PaginationDto,
  ) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { updatedAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
