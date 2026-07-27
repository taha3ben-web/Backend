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
import {
  CreateSafetyIncidentDto,
  ResolveSafetyIncidentDto,
} from "./dto/safety.dto";

@Injectable()
export class SafetyService {
  private readonly logger = new Logger("Safety");

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvider,
    private readonly alerts: AlertService,
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

    const now = new Date();
    const resolving = ["RESOLVED", "FALSE_ALARM"].includes(dto.status);
    return this.prisma.safetyIncident.update({
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
