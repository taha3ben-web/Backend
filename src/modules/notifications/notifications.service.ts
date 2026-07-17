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
import { nextOutboxState } from "../../common/infra/outbox.util";
import {
  isDeliverySuccessful,
  zeroDeliveryError,
  NOTIFICATION_CLAIM_WINDOW_MS,
} from "./notification-delivery.util";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async send(dto: SendNotificationDto): Promise<Notification> {
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const now = new Date();
    const isFuture = scheduledAt != null && scheduledAt.getTime() > now.getTime();

    const notification = await this.prisma.notification.create({
      data: {
        target: dto.target,
        channel: dto.channel ?? "PUSH",
        userId: dto.target === "USER" ? dto.userId : null,
        campaignKey: dto.campaignKey?.trim() || null,
        appId: dto.appId?.trim() || null,
        clientOs: dto.clientOs?.trim().toLowerCase() || null,
        countryCodes: this.normalizeArray(dto.countryCodes, "upper"),
        localeCodes: this.normalizeArray(dto.localeCodes, "lower"),
        driverCityIds: dto.driverCityIds ?? [],
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl?.trim() || null,
        deepLink: dto.deepLink?.trim() || null,
        data: (dto.data ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt,
        // مستحق للتسليم فورًا أو في موعده المجدول؛ يلتقطه الـ relay الدوري لاحقًا.
        nextAttemptAt: scheduledAt ?? now,
      },
    });

    if (!isFuture) {
      // محاولة تسليم فورية داخل الطلب (يحافظ على السلوك الحالي)، لكن الفشل
      // لم يعُد يُفقَد أو يُطلق استثناء: يُخزَّن للـ relay لإعادة المحاولة مع تراجع أسّي.
      await this.deliver(notification);
    }
    return notification;
  }

  /**
   * يحاول تسليم إشعار مرة واحدة ويُخزّن نتيجة المحاولة بشكل دائم
   * (DELIVERED / FAILED مع موعد إعادة محاولة / DEAD إلى DLQ) عبر سياسة
   * التراجع الأسّي المشتركة `nextOutboxState`. لا يُطلق استثناءً أبدًا.
   */
  async deliver(notification: Notification): Promise<void> {
    let threw = false;
    let recipientCount = 0;
    let sentCount = 0;
    let errorMessage: string | null = null;

    try {
      const userIds = await this.resolveRecipients(notification);
      recipientCount = userIds.length;
      sentCount = await this.dispatcher.dispatch({
        channel: notification.channel,
        userIds,
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl ?? undefined,
        deepLink: notification.deepLink ?? undefined,
        data: (notification.data as Record<string, unknown>) ?? undefined,
      });
    } catch (error) {
      threw = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const success = isDeliverySuccessful({ threw, recipientCount, sentCount });
    if (!success && !errorMessage) {
      errorMessage = zeroDeliveryError(recipientCount);
    }

    const transition = nextOutboxState({
      success,
      attempts: notification.attempts,
      maxAttempts: notification.maxAttempts,
      error: errorMessage,
    });

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: {
        deliveryStatus: transition.status,
        attempts: transition.attempts,
        // عند النجاح لا يُعاد جدولته؛ عند الفشل يُؤجَّل وفق التراجع الأسّي.
        nextAttemptAt: success ? null : transition.availableAt,
        lastError: transition.lastError,
        ...(success ? { sentAt: new Date(), sentCount } : {}),
      },
    });

    if (success) {
      this.logger.log(
        `إشعار ${notification.id} أُرسل إلى ${sentCount}/${recipientCount} (${notification.channel})`,
      );
    } else if (transition.status === "DEAD") {
      this.logger.error(
        `إشعار ${notification.id} انتقل إلى DLQ بعد ${transition.attempts} محاولة: ${transition.lastError}`,
      );
    } else {
      this.logger.warn(
        `فشل تسليم الإشعار ${notification.id} (محاولة ${transition.attempts}) — إعادة المحاولة في ${transition.availableAt.toISOString()}: ${transition.lastError}`,
      );
    }
  }

  /**
   * relay دوري: يلتقط الإشعارات المستحقة (الفورية الفاشلة + المجدولة) ويحاول
   * تسليمها. يحجز كل سجل بنافذة رؤية (visibility timeout) لمنع المعالجة
   * المزدوجة عبر عدة نسخ خادم. التسليم at-least-once.
   */
  async processDue(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.notification.findMany({
      where: {
        sentAt: null,
        deliveryStatus: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { not: null, lte: now },
      },
      take: 50,
      orderBy: { nextAttemptAt: "asc" },
    });
    let processed = 0;
    for (const notification of due) {
      // حجز السجل: يدفع nextAttemptAt للأمام؛ لا ينجح إلا لنسخة واحدة.
      const claim = await this.prisma.notification.updateMany({
        where: {
          id: notification.id,
          sentAt: null,
          nextAttemptAt: { lte: now },
        },
        data: {
          nextAttemptAt: new Date(now.getTime() + NOTIFICATION_CLAIM_WINDOW_MS),
        },
      });
      if (claim.count === 0) continue;
      // deliver لا يُطلق استثناءً؛ يُخزّن الحالة النهائية (DELIVERED/FAILED/DEAD).
      await this.deliver(notification);
      processed += 1;
    }
    return processed;
  }

  async findAll(
    q: PaginationDto,
    target?: NotificationTarget,
    campaignKey?: string,
  ) {
    const where: Prisma.NotificationWhereInput = {
      ...(target ? { target } : {}),
      ...(campaignKey ? { campaignKey: campaignKey.trim() } : {}),
    };
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

  async cancelScheduled(id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) throw new NotFoundException("الإشعار غير موجود");
    if (notification.sentAt) {
      throw new NotFoundException("تم إرسال هذا الإشعار بالفعل");
    }
    await this.prisma.notification.delete({ where: { id } });
    return { ok: true };
  }

  async notifyUser(
    userId: string,
    title: string,
    body: string,
    channel: NotificationChannel = "PUSH",
    data?: Record<string, unknown>,
  ) {
    return this.send({ target: "USER", userId, channel, title, body, data });
  }

  private async resolveRecipients(
    notification: Notification,
  ): Promise<string[]> {
    if (notification.target === "USER")
      return notification.userId ? [notification.userId] : [];

    const where: Prisma.UserWhereInput = { status: "ACTIVE" };
    if (notification.target === "DRIVERS") {
      where.type = "DRIVER";
    } else if (notification.target === "PASSENGERS") {
      where.type = "PASSENGER";
    } else {
      where.type = { in: ["DRIVER", "PASSENGER"] };
    }

    if (notification.localeCodes.length > 0) {
      where.locale = { in: notification.localeCodes };
    }

    if (
      notification.driverCityIds.length > 0 &&
      notification.target === "DRIVERS"
    ) {
      where.driver = { cityId: { in: notification.driverCityIds } };
    }

    if (
      notification.countryCodes.length > 0 &&
      notification.target === "DRIVERS"
    ) {
      where.driver = {
        ...(where.driver ?? {}),
        city: { country: { in: notification.countryCodes } },
      };
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private normalizeArray(
    values: string[] | undefined,
    casing: "upper" | "lower",
  ) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values ?? []) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const next =
        casing === "upper" ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (seen.has(next)) continue;
      seen.add(next);
      result.push(next);
    }
    return result;
  }
}
