import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SettingsService } from "../settings/settings.service";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { NotificationDispatcher } from "../notifications/notification-dispatcher.service";
import { RedisService } from "../redis/redis.service";
import { LIVE_TRIP_STATUSES } from "../trips/trip-transitions";

type CommunicationPolicy = {
  enabled?: boolean;
  chatEnabled?: boolean;
  callEnabled?: boolean;
  phoneMode?: "HIDDEN" | "DIRECT" | "BRIDGE";
  bridgeNumber?: string;
  activeStatuses?: string[];
  rateLimitPerMinute?: number;
};

/**
 * القيم المستعملة عند غياب صفّ الإعداد في قاعدة البيانات.
 *
 * سبب وجودها: `settings.getValue` يُرجع `undefined` إن لم يوجد الصفّ، وكان ذلك
 * يجعل `policy.enabled === true` خاطئًا دائمًا فتموت الدردشة بصمت. الصفّ
 * مضاف الآن في seed، لكن قاعدة بيانات قديمة لن تُعاد بذرتها، فالافتراض هنا
 * هو خط الدفاع الثاني.
 *
 * الاتصال الهاتفي يبقى مغلقًا افتراضيًا: كشف رقم هاتف قرار إداري لا افتراض تقني.
 */
const POLICY_FALLBACK: Required<
  Pick<
    CommunicationPolicy,
    "enabled" | "chatEnabled" | "callEnabled" | "phoneMode" | "activeStatuses" | "rateLimitPerMinute"
  >
> = {
  enabled: true,
  chatEnabled: true,
  callEnabled: false,
  phoneMode: "HIDDEN",
  // المرحلة 9: كان "ARRIVED" مدرجًا هنا وهو اسم ميت لا يوجد في enum TripStatus.
  // القائمة الآن مشتقّة من المصدر الموحّد بدل تكرارها نصًّا.
  activeStatuses: [...LIVE_TRIP_STATUSES],
  rateLimitPerMinute: 20,
};

@Injectable()
export class TripCommunicationService {
  private readonly logger = new Logger(TripCommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => NotificationDispatcher))
    private readonly notifications: NotificationDispatcher,
    private readonly redis: RedisService,
  ) {}

  async context(userId: string, tripId: string) {
    const { trip, other } = await this.tripParty(userId, tripId);
    const policy = await this.policy();
    const active =
      policy.enabled === true &&
      (policy.activeStatuses ?? []).includes(trip.status);
    const callable = active && policy.callEnabled === true;
    let phoneNumber: string | null = null;
    if (callable && policy.phoneMode === "DIRECT") phoneNumber = this.safePhone(other.phone);
    if (callable && policy.phoneMode === "BRIDGE") phoneNumber = this.safePhone(policy.bridgeNumber);

    // عدّاد غير المقروء يُحسب على الرسائل الواردة من الطرف الآخر فقط.
    const unreadCount = await this.prisma.tripMessage.count({
      where: { tripId, senderId: { not: userId }, readAt: null },
    });

    return {
      tripId,
      status: trip.status,
      active,
      canChat: active && policy.chatEnabled === true,
      canCall: callable && phoneNumber !== null,
      phoneMode: policy.phoneMode ?? "HIDDEN",
      phoneNumber,
      unreadCount,
      participant: {
        id: other.id,
        name: other.name,
        // مفتاح الكائن لا يصلح للعرض؛ يُولّد الرابط عند كل طلب.
        avatarUrl: await this.storage.resolveStoredUrl(
          other.avatarUrl,
          STORED_MEDIA_READ_TTL_MINUTES,
        ),
      },
    };
  }

  async messages(userId: string, tripId: string, q: PaginationDto) {
    await this.tripParty(userId, tripId);
    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.tripMessage.findMany({
        where: { tripId }, orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit, take: q.limit,
        select: { id: true, tripId: true, senderId: true, body: true, readAt: true, createdAt: true },
      }),
      this.prisma.tripMessage.count({ where: { tripId } }),
      this.prisma.tripMessage.count({
        where: { tripId, senderId: { not: userId }, readAt: null },
      }),
    ]);
    return { items: rows.reverse(), total, unreadCount, page: q.page, limit: q.limit };
  }

  /**
   * يضع علامة "مقروء" على كل رسائل الطرف الآخر في هذه الرحلة.
   *
   * القراءة لا تُقيَّد بحالة الرحلة عمدًا: الراكب قد يفتح المحادثة بعد انتهاء
   * الرحلة ليقرأ ما فاته، ومنعه من ذلك كان سيُبقي الشارة عالقة إلى الأبد.
   * الإرسال وحده هو المقيّد بالرحلة القائمة.
   */
  async markRead(userId: string, tripId: string) {
    await this.tripParty(userId, tripId);
    const readAt = new Date();
    const result = await this.prisma.tripMessage.updateMany({
      where: { tripId, senderId: { not: userId }, readAt: null },
      data: { readAt },
    });
    if (result.count > 0) {
      // إشعار المُرسِل بأن رسائله قُرئت (إيصال قراءة حيّ).
      try {
        this.realtime.emitTripMessagesRead(tripId, userId, readAt);
      } catch (err) {
        this.logger.warn(
          `realtime emitTripMessagesRead failed: ${(err as Error).message}`,
        );
      }
    }
    return { updated: result.count, readAt: readAt.toISOString() };
  }

  async send(userId: string, tripId: string, body: string) {
    const { trip, other } = await this.tripParty(userId, tripId);
    const policy = await this.policy();
    const active =
      policy.enabled === true &&
      (policy.activeStatuses ?? []).includes(trip.status);
    if (!(active && policy.chatEnabled === true)) {
      throw new ForbiddenException("Trip chat is not active");
    }

    await this.enforceRateLimit(userId, tripId, policy.rateLimitPerMinute);

    const message = await this.prisma.tripMessage.create({
      data: { tripId, senderId: userId, body: body.trim() },
      select: { id: true, tripId: true, senderId: true, body: true, readAt: true, createdAt: true },
    });

    // بثّ لحظي للطرف الآخر; فشل البثّ لا يُفشِل حفظ الرسالة.
    try {
      this.realtime.emitTripMessage(tripId, message);
    } catch (err) {
      this.logger.warn(
        `realtime emitTripMessage failed: ${(err as Error).message}`,
      );
    }

    // Push للطرف الآخر عبر NotificationDispatcher الموجود (لا خدمة دفع ثانية).
    // ضروري لأن الـ socket يُغلق في الخلفية/عند إغلاق التطبيق، فبدون هذا
    // كانت الرسالة تصل فقط لمن يُبقي الشاشة مفتوحة.
    void this.pushToRecipient(tripId, other.id, message.body);

    return message;
  }

  /**
   * إشعار الطرف المستقبِل. لا يرمي أبدًا: فشل الدفع لا يجوز أن يُفشل
   * إرسال رسالة حُفظت وبُثّت بنجاح.
   *
   * `data.type = "TRIP_MESSAGE"` و`deepLink` هما العقد الذي يعتمده التطبيقان
   * لفتح شاشة المحادثة مباشرة من الإشعار.
   */
  private async pushToRecipient(tripId: string, recipientId: string, body: string) {
    try {
      const sender = await this.prisma.tripMessage.findFirst({
        where: { tripId },
        orderBy: { createdAt: "desc" },
        select: { sender: { select: { name: true } } },
      });
      const title = sender?.sender?.name?.trim() || "رسالة جديدة";
      await this.notifications.dispatch({
        channel: "PUSH",
        userIds: [recipientId],
        title,
        // نقتطع المعاينة: الإشعار يظهر على شاشة مقفلة قد يراها غير صاحب الهاتف.
        body: body.length > 120 ? `${body.slice(0, 117)}...` : body,
        deepLink: `flamingo://trip/${tripId}/chat`,
        data: { type: "TRIP_MESSAGE", tripId },
      });
    } catch (err) {
      this.logger.warn(
        `push for trip message failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * حدّ إرسال لكل (مستخدم، رحلة) في نافذة دقيقة، عبر عدّاد Redis.
   *
   * الحدّ الموجود في RealtimeGateway يحمي أحداث الـ socket فقط، بينما الرسائل
   * تُرسل عبر HTTP POST — فكان المسار غير محمي من الإغراق إطلاقًا.
   *
   * fail-open عن قصد: إن سقط Redis، لا نمنع ركّابًا حقيقيين من التواصل مع
   * سائقهم لأجل عدّاد مكافحة إزعاج.
   */
  private async enforceRateLimit(
    userId: string,
    tripId: string,
    limit?: number,
  ) {
    const max = Number.isFinite(limit) && (limit as number) > 0
      ? (limit as number)
      : POLICY_FALLBACK.rateLimitPerMinute;
    try {
      const key = `tripchat:rate:${tripId}:${userId}`;
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, 60);
      if (count > max) {
        throw new ForbiddenException("MESSAGE_RATE_LIMITED");
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(`chat rate limit unavailable: ${(err as Error).message}`);
    }
  }

  private async tripParty(userId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true, passengerId: true,
        passenger: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { user: { select: { id: true, name: true, phone: true, avatarUrl: true } } } },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    const driverUser = trip.driver?.user;
    const isPassenger = trip.passengerId === userId;
    const isDriver = driverUser?.id === userId;
    if (!isPassenger && !isDriver) throw new NotFoundException("Trip not found");
    const other = isPassenger ? driverUser : trip.passenger;
    if (!other) throw new ForbiddenException("Trip has no assigned participant");
    return { trip, other };
  }

  private async policy(): Promise<CommunicationPolicy> {
    const stored = await this.settings.getValue<CommunicationPolicy>(
      "passenger.tripCommunication",
    );
    return { ...POLICY_FALLBACK, ...(stored ?? {}) };
  }

  private safePhone(value?: string | null) {
    const phone = value?.trim() ?? "";
    return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
  }
}
