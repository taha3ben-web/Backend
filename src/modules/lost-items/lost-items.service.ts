import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { LostItemStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TransactionalEmailService } from "../notifications/transactional-email.service";
import {
  lostItemStatusLabel,
  recipientLocale,
} from "../notifications/transactional-email.util";
import { AlertService } from "../../common/observability/alert.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { maskPhone } from "../calls/call-masking.adapter";
import {
  CreateLostItemDto,
  UpdateLostItemStatusDto,
} from "./dto/lost-item.dto";

/** عدد الأيام التي يُقبل خلالها البلاغ بعد انتهاء الرحلة. */
export const LOST_ITEM_REPORT_WINDOW_DAYS = 30;
/** الحالات التي تُعتبر مغلقة. */
export const CLOSED_LOST_ITEM_STATUSES: LostItemStatus[] = [
  "RETURNED",
  "NOT_FOUND",
  "CLOSED",
];

/**
 * المفقودات: دورة حياة مستقلة عن الشكاوى وتذاكر الدعم، لأنّ المطلوب
 * هنا إيصال غرض إلى صاحبه وليس معاقبة أحد.
 *
 * مبدأ الخصوصية: السائق يُبلّغ بوجود غرض مفقود لكنّه **لا يرى رقم الراكب**؛
 * التنسيق يجري عبر الدعم أو قناة الاتصال المخفيّة.
 */
@Injectable()
export class LostItemsService {
  private readonly logger = new Logger("LostItems");

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly mailer?: TransactionalEmailService,
  ) {}

  /** يفتح بلاغ فقدان على رحلة انتهت يملكها الراكب. */
  async create(userId: string, dto: CreateLostItemDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        completedAt: true,
        createdAt: true,
        driver: { select: { userId: true } },
      },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (trip.passengerId !== userId) {
      throw new ForbiddenException("لا يمكنك فتح بلاغ على رحلة ليست لك");
    }
    if (trip.status !== "COMPLETED") {
      throw new BadRequestException(
        "يُفتح بلاغ المفقودات بعد انتهاء الرحلة فقط",
      );
    }

    const reference = trip.completedAt ?? trip.createdAt;
    const ageDays = (Date.now() - reference.getTime()) / 86_400_000;
    if (ageDays > LOST_ITEM_REPORT_WINDOW_DAYS) {
      throw new BadRequestException(
        `مضت أكثر من ${LOST_ITEM_REPORT_WINDOW_DAYS} يومًا على هذه الرحلة`,
      );
    }

    const item = await this.prisma.lostItem.create({
      data: {
        tripId: dto.tripId,
        reporterId: userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        contactPhone: dto.contactPhone?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
      },
    });

    void this.dispatch(item.id, trip.driver?.userId ?? null, dto.title).catch(
      () => undefined,
    );

    return item;
  }

  /** يُبلّغ السائق وفريق الدعم (أفضل-جهد، ومع تسجيل صريح للفشل). */
  private async dispatch(
    itemId: string,
    driverUserId: string | null,
    title: string,
  ): Promise<void> {
    if (driverUserId && this.notifications) {
      try {
        await this.notifications.notifyUser(
          driverUserId,
          "غرض مفقود في سيارتك",
          `أبلغ راكب عن نسيان: ${title}. يُرجى التحقّق من السيارة وتحديث الحالة.`,
          "PUSH",
          { kind: "lost_item", lostItemId: itemId },
        );
        await this.prisma.lostItem.update({
          where: { id: itemId },
          data: { status: "DRIVER_NOTIFIED" },
        });
      } catch (error) {
        this.logger.error(
          `تعذر إبلاغ السائق بالمفقود ${itemId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else if (!driverUserId) {
      this.logger.warn(`المفقود ${itemId} بلا سائق مرتبط`);
    }

    await this.alerts
      ?.emit({
        kind: "support.lost_item",
        severity: "INFO",
        title: "بلاغ مفقودات جديد",
        message: title,
        context: { id: itemId },
      })
      .catch(() => undefined);
  }

  /** بلاغات الراكب نفسه. */
  async mine(userId: string) {
    return this.prisma.lostItem.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** بلاغات مرتبطة برحلة يراها السائق — بلا أي رقم خام. */
  async forDriver(driverUserId: string) {
    const items = await this.prisma.lostItem.findMany({
      where: { trip: { driver: { userId: driverUserId } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        tripId: true,
        title: true,
        description: true,
        status: true,
        contactPhone: true,
        createdAt: true,
      },
    });
    return items.map((item) => ({
      ...item,
      contactPhone: maskPhone(item.contactPhone),
    }));
  }

  /** قائمة الموظّفين مع ترقيم وتصفية بالحالة. */
  async list(q: PaginationDto, status?: LostItemStatus) {
    const where: Prisma.LostItemWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lostItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.lostItem.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** تحديث الحالة من الدعم، مع إعلام الراكب بالنتيجة. */
  async updateStatus(
    staffId: string,
    id: string,
    dto: UpdateLostItemStatusDto,
  ) {
    const existing = await this.prisma.lostItem.findUnique({
      where: { id },
      select: { id: true, reporterId: true, title: true },
    });
    if (!existing) throw new NotFoundException("البلاغ غير موجود");

    const closing = CLOSED_LOST_ITEM_STATUSES.includes(dto.status);
    const updated = await this.prisma.lostItem.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNote: dto.note?.trim() || null,
        resolvedById: closing ? staffId : null,
        resolvedAt: closing ? new Date() : null,
      },
    });

    if (this.notifications) {
      await this.notifications
        .notifyUser(
          existing.reporterId,
          "تحديث بلاغ المفقودات",
          `حالة بلاغ "${existing.title}" أصبحت: ${dto.status}`,
          "PUSH",
          { kind: "lost_item", lostItemId: id, status: dto.status },
        )
        .catch(() => undefined);
    }

    await this.emailStatusUpdate(
      existing.reporterId,
      existing.title,
      dto.status,
    );

    return updated;
  }

  /**
   * بريد تحديث البلاغ — أفضل جهد. الحالة تُترجم إلى نص مقروء
   * بلغة المستخدم بدل إرسال رمز داخلي مثل DRIVER_NOTIFIED.
   */
  private async emailStatusUpdate(
    reporterId: string,
    itemTitle: string,
    status: LostItemStatus,
  ): Promise<void> {
    if (!this.mailer) return;
    const reporter = await this.prisma.user
      .findUnique({ where: { id: reporterId }, select: { locale: true } })
      .catch(() => null);
    const locale = recipientLocale(reporter?.locale);
    this.mailer.fireAndForget({
      userId: reporterId,
      template: "lost_item_update",
      vars: {
        itemTitle,
        status: lostItemStatusLabel(status, locale),
      },
    });
  }
}
