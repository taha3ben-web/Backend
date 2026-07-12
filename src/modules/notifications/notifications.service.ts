import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Notification,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationTarget,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ListNotificationsQueryDto,
  SendNotificationDto,
  UpdateNotificationTemplateDto,
  UpsertNotificationTemplateDto,
} from "./dto/notifications.dto";
import { NotificationDispatcher } from "./notification-dispatcher.service";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  async send(dto: SendNotificationDto): Promise<Notification> {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.notification.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return existing;
    }

    const message = await this.resolveMessage(dto);
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    const isFuture = scheduledAt != null && scheduledAt.getTime() > Date.now();

    const notification = await this.prisma.notification.create({
      data: {
        target: dto.target,
        channel: message.channel,
        userId: dto.target === "USER" ? dto.userId ?? null : null,
        title: message.title,
        body: message.body,
        data: (dto.data ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt,
        nextAttemptAt: isFuture ? scheduledAt : new Date(),
        templateKey: dto.templateKey ?? null,
        variables: (dto.variables ?? undefined) as Prisma.InputJsonValue | undefined,
        maxAttempts: dto.maxAttempts ?? 5,
        status: NotificationDeliveryStatus.PENDING,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
    });

    if (isFuture) return notification;
    return this.attemptDelivery(notification.id);
  }

  async processDue(): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: {
        sentAt: null,
        status: NotificationDeliveryStatus.PENDING,
        nextAttemptAt: { not: null, lte: new Date() },
      },
      take: 50,
      orderBy: { nextAttemptAt: "asc" },
    });
    let processed = 0;
    for (const n of due) {
      const updated = await this.attemptDelivery(n.id);
      if (updated.status === NotificationDeliveryStatus.SENT) {
        processed += 1;
      }
    }
    return processed;
  }

  async findAll(q: ListNotificationsQueryDto) {
    const where: Prisma.NotificationWhereInput = {};
    if (q.target) where.target = q.target;
    if (q.status) where.status = q.status;
    if (q.templateKey) where.templateKey = q.templateKey;
    if (q.search?.trim()) {
      const search = q.search.trim();
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { body: { contains: search, mode: "insensitive" } },
      ];
    }

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

  async forUser(
    userId: string,
    type: NotificationTarget[],
    q: { page: number; limit: number },
  ) {
    const where: Prisma.NotificationWhereInput = {
      status: NotificationDeliveryStatus.SENT,
      OR: [{ userId }, { target: { in: type } }],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { sentAt: "desc" },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async cancelScheduled(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException("الإشعار غير موجود");
    if (notification.status === NotificationDeliveryStatus.SENT || notification.sentAt) {
      throw new BadRequestException("تم إرسال هذا الإشعار بالفعل");
    }
    return this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationDeliveryStatus.CANCELED,
        nextAttemptAt: null,
        lastError: null,
      },
    });
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

  async listTemplates() {
    return this.prisma.notificationTemplate.findMany({
      orderBy: [{ enabled: "desc" }, { key: "asc" }],
    });
  }

  async upsertTemplate(dto: UpsertNotificationTemplateDto) {
    return this.prisma.notificationTemplate.upsert({
      where: { key: dto.key },
      update: {
        name: dto.name,
        channel: dto.channel,
        titleTemplate: dto.titleTemplate,
        bodyTemplate: dto.bodyTemplate,
        enabled: dto.enabled ?? true,
      },
      create: {
        key: dto.key,
        name: dto.name,
        channel: dto.channel,
        titleTemplate: dto.titleTemplate,
        bodyTemplate: dto.bodyTemplate,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateTemplate(key: string, dto: UpdateNotificationTemplateDto) {
    const template = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    if (!template) throw new NotFoundException("القالب غير موجود");
    return this.prisma.notificationTemplate.update({
      where: { key },
      data: {
        name: dto.name,
        channel: dto.channel,
        titleTemplate: dto.titleTemplate,
        bodyTemplate: dto.bodyTemplate,
        enabled: dto.enabled,
      },
    });
  }

  async removeTemplate(key: string) {
    await this.prisma.notificationTemplate.delete({ where: { key } });
    return { ok: true };
  }

  async attemptDelivery(id: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException("الإشعار غير موجود");
    if (notification.sentAt || notification.status === NotificationDeliveryStatus.CANCELED) {
      return notification;
    }

    const claim = await this.prisma.notification.updateMany({
      where: {
        id,
        sentAt: null,
        status: NotificationDeliveryStatus.PENDING,
      },
      data: {
        status: NotificationDeliveryStatus.PROCESSING,
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError: null,
      },
    });
    if (claim.count === 0) {
      const latest = await this.prisma.notification.findUnique({ where: { id } });
      if (!latest) throw new NotFoundException("الإشعار غير موجود");
      return latest;
    }

    const current = await this.prisma.notification.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("الإشعار غير موجود");

    try {
      const userIds = await this.resolveRecipients(current.target, current.userId);
      const count = await this.dispatcher.dispatch({
        channel: current.channel,
        userIds,
        title: current.title,
        body: current.body,
        data: (current.data as Record<string, unknown>) ?? undefined,
      });
      const failedCount = Math.max(userIds.length - count, 0);
      return this.prisma.notification.update({
        where: { id },
        data: {
          status: NotificationDeliveryStatus.SENT,
          sentAt: new Date(),
          nextAttemptAt: null,
          sentCount: count,
          failedCount,
          lastError:
            failedCount > 0 ? `Partial delivery ${count}/${userIds.length}` : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = current.attempts >= current.maxAttempts;
      this.logger.error(`فشل إرسال الإشعار ${id}: ${message}`);
      return this.prisma.notification.update({
        where: { id },
        data: {
          status: exhausted
            ? NotificationDeliveryStatus.FAILED
            : NotificationDeliveryStatus.PENDING,
          nextAttemptAt: exhausted ? null : this.computeBackoff(current.attempts),
          lastError: message.slice(0, 500),
          failedCount: { increment: 1 },
        },
      });
    }
  }

  private async resolveMessage(dto: SendNotificationDto): Promise<{
    channel: NotificationChannel;
    title: string;
    body: string;
  }> {
    if (dto.templateKey) {
      const template = await this.prisma.notificationTemplate.findUnique({
        where: { key: dto.templateKey },
      });
      if (!template || !template.enabled) {
        throw new NotFoundException("قالب الإشعار غير موجود أو غير مفعّل");
      }
      const title = dto.title?.trim() || this.renderTemplate(template.titleTemplate, dto.variables);
      const body = dto.body?.trim() || this.renderTemplate(template.bodyTemplate, dto.variables);
      return {
        channel: dto.channel ?? template.channel,
        title,
        body,
      };
    }

    if (!dto.title?.trim() || !dto.body?.trim()) {
      throw new BadRequestException("العنوان والنص مطلوبان عند عدم استخدام قالب");
    }
    return {
      channel: dto.channel ?? NotificationChannel.PUSH,
      title: dto.title.trim(),
      body: dto.body.trim(),
    };
  }

  private renderTemplate(
    template: string,
    variables?: Record<string, unknown>,
  ): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = key.split(".").reduce<unknown>((acc, part) => {
        if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
          return (acc as Record<string, unknown>)[part];
        }
        return undefined;
      }, variables ?? {});
      if (value === null || value === undefined) return "";
      return String(value);
    });
  }

  private async resolveRecipients(
    target: NotificationTarget,
    userId: string | null,
  ): Promise<string[]> {
    if (target === "USER") return userId ? [userId] : [];

    const where: Prisma.UserWhereInput = { status: "ACTIVE" };
    if (target === "DRIVERS") where.type = "DRIVER";
    else if (target === "PASSENGERS") where.type = "PASSENGER";
    else where.type = { in: ["DRIVER", "PASSENGER"] };

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private computeBackoff(attempt: number): Date {
    const minutes = Math.min(60, Math.max(1, Math.pow(2, Math.max(0, attempt - 1))));
    return new Date(Date.now() + minutes * 60_000);
  }
}
