import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

/**
 * المنظور الإداري للتواصل داخل الرحلة.
 *
 * مبدأ التصميم: الإدارة ترى **ما تحتاجه للتشغيل والنزاعات فقط**.
 * لذلك فُصِلت الطبقتان:
 *
 * 1. `summary` — بيانات وصفية فقط (عدد الرسائل، من بدأ، آخر نشاط، غير المقروء،
 *    عدد جلسات الاتصال). **لا نصوص رسائل ولا أرقام هواتف.** يكفي لمعرفة
 *    هل تواصل الطرفان؟ ومتى؟ وهل تُركت رسالة دون قراءة؟
 *
 * 2. `transcript` — نص المحادثة. محتوى خاص بين طرفين، فلا يُفتح إلا بصلاحية
 *    أعلى (`support.manage`) ويُسجّل في AuditLog. لا يُعرَض في قوائم التصفح.
 *
 * أرقام الهواتف لا تُعاد أبدًا من هنا — حتى في النسخ الإدارية — وجلسات الاتصال
 * تُعرض مقنّعة (آخر أربعة أرقام فقط).
 */
@Injectable()
export class TripCommunicationAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** قائمة الرحلات التي دار فيها تواصل، مع عدّادات وصفية فقط. */
  async list(q: PaginationDto) {
    const grouped = await this.prisma.tripMessage.groupBy({
      by: ["tripId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });

    const tripIds = grouped.map((row) => row.tripId);
    const trips = tripIds.length
      ? await this.prisma.trip.findMany({
          where: { id: { in: tripIds } },
          select: {
            id: true,
            status: true,
            createdAt: true,
            passenger: { select: { id: true, name: true } },
            driver: { select: { user: { select: { id: true, name: true } } } },
          },
        })
      : [];
    const byId = new Map(trips.map((trip) => [trip.id, trip]));

    const unread = tripIds.length
      ? await this.prisma.tripMessage.groupBy({
          by: ["tripId"],
          where: { tripId: { in: tripIds }, readAt: null },
          _count: { _all: true },
        })
      : [];
    const unreadById = new Map(unread.map((row) => [row.tripId, row._count._all]));

    const items = grouped.map((row) => {
      const trip = byId.get(row.tripId);
      return {
        tripId: row.tripId,
        status: trip?.status ?? null,
        passenger: trip?.passenger ?? null,
        driver: trip?.driver?.user ?? null,
        messageCount: row._count._all,
        unreadCount: unreadById.get(row.tripId) ?? 0,
        lastMessageAt: row._max.createdAt,
      };
    });

    // عدد المحادثات المتميّزة، لا عدد الرسائل.
    const distinct = await this.prisma.tripMessage.findMany({
      distinct: ["tripId"],
      select: { tripId: true },
    });

    return { items, total: distinct.length, page: q.page, limit: q.limit };
  }

  /** ملخّص رحلة واحدة دون نصوص. */
  async summary(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        passenger: { select: { id: true, name: true } },
        driver: { select: { user: { select: { id: true, name: true } } } },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const [messageCount, unreadCount, first, last, callSessions] =
      await this.prisma.$transaction([
        this.prisma.tripMessage.count({ where: { tripId } }),
        this.prisma.tripMessage.count({ where: { tripId, readAt: null } }),
        this.prisma.tripMessage.findFirst({
          where: { tripId },
          orderBy: { createdAt: "asc" },
          select: { senderId: true, createdAt: true },
        }),
        this.prisma.tripMessage.findFirst({
          where: { tripId },
          orderBy: { createdAt: "desc" },
          select: { senderId: true, createdAt: true },
        }),
        this.prisma.callSession.findMany({
          where: { tripId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            provider: true,
            callerRole: true,
            proxyNumber: true,
            callCount: true,
            lastCallAt: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      tripId,
      status: trip.status,
      passenger: trip.passenger,
      driver: trip.driver?.user ?? null,
      messageCount,
      unreadCount,
      firstMessageAt: first?.createdAt ?? null,
      lastMessageAt: last?.createdAt ?? null,
      lastSenderId: last?.senderId ?? null,
      calls: callSessions.map((session) => ({
        ...session,
        // حتى الإدارة لا تحتاج رقم الجسر كاملًا لتتبّع مكالمة.
          proxyNumber: maskTail(session.proxyNumber),
      })),
    };
  }

  /**
   * نص المحادثة الكامل. محمي بصلاحية أعلى ومُسجّل في AuditLog
   * (عبر AuditInterceptor المربوط بالمسار في الـ controller).
   */
  async transcript(tripId: string, q: PaginationDto) {
    const exists = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Trip not found");

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tripMessage.findMany({
        where: { tripId },
        orderBy: { createdAt: "asc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          senderId: true,
          body: true,
          readAt: true,
          createdAt: true,
          sender: { select: { id: true, name: true } },
        },
      }),
      this.prisma.tripMessage.count({ where: { tripId } }),
    ]);

    return { items: rows, total, page: q.page, limit: q.limit };
  }
}

/** يُبقي آخر أربعة أرقام فقط: يكفي للمطابقة ولا يكشف رقمًا قابلًا للاتصال. */
function maskTail(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return `****${digits}`;
  return `****${digits.slice(-4)}`;
}
