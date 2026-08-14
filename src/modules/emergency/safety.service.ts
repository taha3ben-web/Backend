import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { SafetyIncidentStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AlertService } from "../../common/observability/alert.service";
import { SmsProvider } from "../notifications/providers/sms.provider";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AuditService } from "../rbac/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  CreateSafetyIncidentDto,
  ResolveSafetyIncidentDto,
} from "./dto/safety.dto";

/**
 * الانتقالات المسموحة لحالة بلاغ السلامة.
 *
 * البلاغ المُغلق (RESOLVED / FALSE_ALARM) نهائي: إعادة فتحه كانت تمسح
 * `resolvedById` و`resolvedAt` — أي تمحو بالضبط الدليل على من أغلق البلاغ ومتى،
 * وهو أهم ما يُطلب بعد حادث حقيقي. الإغلاق الخاطئ يُصحَّح ببلاغ جديد لا بالتراجع.
 */
const ALLOWED_TRANSITIONS: Record<
  SafetyIncidentStatus,
  SafetyIncidentStatus[]
> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"],
  ACKNOWLEDGED: ["RESOLVED", "FALSE_ALARM"],
  RESOLVED: [],
  FALSE_ALARM: [],
};

@Injectable()
export class SafetyService {
  private readonly logger = new Logger("Safety");

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvider,
    private readonly alerts: AlertService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateSafetyIncidentDto) {
    if (dto.tripId) {
      const trip = await this.prisma.trip.findFirst({
        where: {
          id: dto.tripId,
          OR: [{ passengerId: userId }, { driver: { userId } }],
        },
        select: { id: true },
      });
      if (!trip) throw new BadRequestException("الرحلة غير مرتبطة بالمستخدم");
    }

    const existing = await this.prisma.safetyIncident.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) return existing;

    const created = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.safetyIncident.create({
        data: {
          userId,
          tripId: dto.tripId,
          type: dto.type ?? "SOS",
          lat: dto.lat,
          lng: dto.lng,
          accuracy: dto.accuracy,
          message: dto.message,
          idempotencyKey: dto.idempotencyKey,
        },
        include: this.incidentInclude(),
      });
      if (dto.tripId) {
        await tx.tripEvent.create({
          data: {
            tripId: dto.tripId,
            type: "SAFETY_SOS_CREATED",
            actor: "SYSTEM",
            meta: { incidentId: incident.id, reporterId: userId },
          },
        });
      }
      return incident;
    });

    // الإبلاغ الفعلي بعد تثبيت المعاملة: قبل اليوم كان الـ SOS يُخزّن في الجدول
    // ولا يصل أحدًا — وهذا أخطر من عدم وجود الميزة أصلًا لأنّه يمنح طمأنينة كاذبة.
    // الإبلاغ بأفضل جهد ولا يُفشل الطلب (البلاغ محفوظ على كل حال).
    void this.dispatchSos(created).catch(() => undefined);

    // سجل التدقيق: من أنشأ البلاغ ومتى. حقول الجدول تحفظ المعالِج فقط،
    // فبدون هذا السطر لا يظهر إنشاء البلاغ في سجل التدقيق المركزي إطلاقًا.
    void this.audit
      .record({
        actorId: userId,
        action: "safety.incident.created",
        entity: "SafetyIncident",
        entityId: created.id,
        meta: {
          type: created.type,
          tripId: created.tripId ?? null,
          hasPosition: created.lat != null && created.lng != null,
        },
      })
      .catch(() => undefined);

    return created;
  }

  /**
   * يُطلق تنبيهًا حرجًا لفريق الدعم، ويرسل SMS لجهات طوارئ المبلّغ.
   * إن لم تكن بوابة SMS مضبوطة يُسجّل ذلك صراحةً بدل الصمت.
   */
  private async dispatchSos(incident: {
    id: string;
    userId: string;
    tripId: string | null;
    type: string;
    lat: number | null;
    lng: number | null;
  }): Promise<void> {
    const [reporter, contacts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: incident.userId },
        select: { name: true, phone: true },
      }),
      this.prisma.emergencyContact.findMany({
        where: { userId: incident.userId },
        select: { phone: true },
        take: 5,
      }),
    ]);

    const position =
      incident.lat != null && incident.lng != null
        ? `https://maps.google.com/?q=${incident.lat},${incident.lng}`
        : null;

    await this.alerts.emit({
      kind: "safety.sos",
      severity: "CRITICAL",
      title: `بلاغ سلامة (${incident.type})`,
      message: `مبلّغ: ${reporter?.name ?? incident.userId} — ${reporter?.phone ?? ""}${
        position ? ` — ${position}` : ""
      }`,
      context: {
        id: incident.id,
        tripId: incident.tripId,
        userId: incident.userId,
      },
    });

    // إشعار داخل التطبيق للمبلّغ نفسه: تأكيد أن النداء وصل فعلًا.
    // بدونه يبقى المستخدم في لحظة خطر بلا أي دليل على أن أحدًا استلم بلاغه.
    void this.notifications
      .notifyUser(
        incident.userId,
        "تم استلام نداء الاستغاثة",
        "فريق السلامة اطّلع على بلاغك ويتابعه الآن.",
        "PUSH",
        {
          kind: "safety",
          incidentId: incident.id,
          tripId: incident.tripId,
        },
      )
      .catch(() => undefined);

    const phones = contacts.map((c) => c.phone).filter(Boolean);
    if (phones.length === 0) return;
    if (!this.sms.isConfigured) {
      this.logger.error(
        `SOS ${incident.id}: بوابة SMS غير مضبوطة — لم يُبلّغ ${phones.length} جهة طوارئ`,
      );
      return;
    }

    const body = `flaminGO: ${reporter?.name ?? "مستخدم"} أطلق نداء استغاثة أثناء رحلة.${
      position ? ` الموقع: ${position}` : ""
    }`;
    const sent = await this.sms.send({ phones, body });
    if (sent === 0) {
      this.logger.error(`SOS ${incident.id}: فشل إبلاغ جميع جهات الطوارئ`);
    }
  }

  mine(userId: string) {
    return this.prisma.safetyIncident.findMany({
      where: { userId },
      include: this.incidentInclude(),
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async list(q: PaginationDto, status?: SafetyIncidentStatus) {
    const where = {
      ...(status ? { status } : {}),
      ...(q.search
        ? {
            OR: [
              { message: { contains: q.search, mode: "insensitive" as const } },
              {
                user: {
                  name: { contains: q.search, mode: "insensitive" as const },
                },
              },
              { user: { phone: { contains: q.search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.safetyIncident.findMany({
        where,
        include: this.incidentInclude(),
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.safetyIncident.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async updateStatus(
    id: string,
    staffId: string,
    dto: ResolveSafetyIncidentDto,
  ) {
    const current = await this.prisma.safetyIncident.findUnique({
      where: { id },
    });
    if (!current) throw new NotFoundException("بلاغ السلامة غير موجود");

    // حارس الانتقال: قبل اليوم كان بالإمكان إرجاع بلاغ مُغلق إلى OPEN،
    // فتُمحى بيانات من عالجه ومتى. لا انتقال إلى نفس الحالة ولا تراجع بعد الإغلاق.
    if (current.status !== dto.status) {
      const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `لا يمكن نقل البلاغ من ${current.status} إلى ${dto.status}`,
        );
      }
    }

    const now = new Date();
    const resolving = ["RESOLVED", "FALSE_ALARM"].includes(dto.status);
    const updated = await this.prisma.safetyIncident.update({
      where: { id },
      data: {
        status: dto.status,
        acknowledgedById:
          current.acknowledgedById ??
          (dto.status !== "OPEN" ? staffId : undefined),
        acknowledgedAt:
          current.acknowledgedAt ?? (dto.status !== "OPEN" ? now : undefined),
        resolvedById: resolving ? staffId : undefined,
        resolvedAt: resolving ? now : undefined,
        resolutionNote: resolving ? (dto.note ?? null) : undefined,
      },
      include: this.incidentInclude(),
    });

    // سجل التدقيق: من غيّر الحالة، من أي حالة إلى أي حالة، ومتى.
    void this.audit
      .record({
        actorId: staffId,
        action: "safety.incident.status",
        entity: "SafetyIncident",
        entityId: id,
        meta: {
          from: current.status,
          to: dto.status,
          reporterId: current.userId,
          tripId: current.tripId ?? null,
        },
      })
      .catch(() => undefined);

    return updated;
  }

  private incidentInclude() {
    return {
      user: { select: { id: true, name: true, phone: true, type: true } },
      trip: {
        select: {
          id: true,
          status: true,
          pickupAddress: true,
          destAddress: true,
          driver: { select: { user: { select: { name: true, phone: true } } } },
        },
      },
      acknowledgedBy: { select: { id: true, name: true } },
      resolvedBy: { select: { id: true, name: true } },
    };
  }
}
