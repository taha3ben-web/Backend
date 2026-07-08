import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  Notification,
  NotificationChannel,
  NotificationTarget,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { SendNotificationDto } from "./dto/notifications.dto";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /** إنشاء إشعار: فوري أو مجدول (يلتقطه الـ Cron) */
  async send(dto: SendNotificationDto): Promise<Notification> {
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const isFuture = scheduledAt != null && scheduledAt.getTime() > Date.now();

    const notification = await this.prisma.notification.create({
      data: {
        target: dto.target,
        channel: dto.channel ?? "PUSH",
        userId: dto.target === "USER" ? dto.userId : null,
        title: dto.title,
        body: dto.body,
        data: (dto.data ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt,
      },
    });

    if (!isFuture) {
      await this.deliver(notification);
    }
    return notification;
  }

  /** يُرسل الإشعار فعليًا ويضع sentAt */
  async deliver(notification: Notification): Promise<void> {
    const userIds = await this.resolveRecipients(
      notification.target,
      notification.userId,
    );
    const count = await this.dispatcher.dispatch({
      channel: notification.channel,
      userIds,
      title: notification.title,
      body: notification.body,
      data: (notification.data as Record<string, unknown>) ?? undefined,
    });
    this.logger.log(
      `إشعار ${notification.id} أُرسل إلى ${count}/${userIds.length} (${notification.channel})`,
    );
    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { sentAt: new Date() },
    });
  }

  /** الإشعارات المستحقة الآن (للـ Cron) */
  async processDue(): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: { sentAt: null, scheduledAt: { not: null, lte: new Date() } },
      take: 50,
      orderBy: { scheduledAt: "asc" },
    });
    let processed = 0;
    for (const n of due) {
      // مطالبة ذرية على مستوى الصف قبل الإرسال: يمنع تكرار الإرسال
      // عندما تُشغّل عدة نسخ (Cloud Run) نفس الـ Cron في الدقيقة نفسها.
      const claim = await this.prisma.notification.updateMany({
        where: { id: n.id, sentAt: null },
        data: { sentAt: new Date() },
      });
      if (claim.count === 0) continue; // التقطته نسخة أخرى
      try {
        await this.deliver(n);
        processed++;
      } catch (err) {
        this.logger.error(`فشل إرسال الإشعار المجدول ${n.id}: ${err}`);
        // أعد الحالة إلى "غير مُرسَل" ليُعاد المحاولة لاحقًا بدل الفقدان الصامت.
        await this.prisma.notification
          .updateMany({ where: { id: n.id }, data: { sentAt: null } })
          .catch(() => undefined);
      }
    }
    return processed;
  }

  /** سجل الإشعارات (لوحة التحكم) */
  async findAll(q: PaginationDto, target?: NotificationTarget) {
    const where: Prisma.NotificationWhereInput = target ? { target } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, phone: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** إشعارات مستخدم معيّن (تخصه مباشرة أو بث عام) */
  async forUser(userId: string, type: NotificationTarget[], q: PaginationDto) {
    const where: Prisma.NotificationWhereInput = {
      OR: [{ userId }, { target: { in: type } }],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** حذف إشعار مجدول لم يُرسل بعد */
  async cancelScheduled(id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException("الإشعار غير موجود");
    if (n.sentAt) {
      throw new NotFoundException("تم إرسال هذا الإشعار بالفعل");
    }
    await this.prisma.notification.delete({ where: { id } });
    return { ok: true };
  }

  /** إشعار داخلي سريع تستدعيه خدمات أخرى (مثل قبول رحلة) */
  async notifyUser(
    userId: string,
    title: string,
    body: string,
    channel: NotificationChannel = "PUSH",
    data?: Record<string, unknown>,
  ) {
    return this.send({ target: "USER", userId, channel, title, body, data });
  }

  /** تحديد المستقبلين حسب الهدف */
  private async resolveRecipients(
    target: NotificationTarget,
    userId: string | null,
  ): Promise<string[]> {
    if (target === "USER") return userId ? [userId] : [];

    const where: Prisma.UserWhereInput = { status: "ACTIVE" };
    if (target === "DRIVERS") where.type = "DRIVER";
    else if (target === "PASSENGERS") where.type = "PASSENGER";
    else where.type = { in: ["DRIVER", "PASSENGER"] }; // ALL (دون الموظفين)

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
