import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Prisma, UserStatus, UserType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { StorageService } from "../storage/storage.service";
import {
  PassengerUploadUrlDto,
  UpdatePassengerProfileDto,
} from "./dto/passenger-self.dto";
import { FinancialService } from "../financial/financial.service";
import { SettingsService } from "../settings/settings.service";

/** مقدّمة مفاتيح صور الركّاب في التخزين. */
const AVATAR_PREFIX = "passenger-profiles/";
/** مدّة الرابط الموقّع حين لا يكون R2_PUBLIC_URL مضبوطاً (أسبوع). */
const AVATAR_READ_TTL_MINUTES = 60 * 24 * 7;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly financial: FinancialService,
    private readonly settings: SettingsService,
  ) {}

  async findAll(q: PaginationDto, type?: UserType) {
    const where: Prisma.UserWhereInput = {
      ...(type ? { type } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { phone: { contains: q.search } },
              { email: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          type: true,
          status: true,
          gender: true,
          locale: true,
          onboardingCompletedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        ratingsReceived: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    const ledgerBalance = await this.financial.getUserBalance(id);
    return {
      ...user,
      ledgerBalance,
      // حقل توافق مؤقت للواجهات القديمة؛ المصدر الفعلي هو Ledger.
      wallet: { ...ledgerBalance, source: "LEDGER" as const },
    };
  }

  /**
   * Customer 360 (قراءة فقط): يجمع ملف المستخدم مع ملخص الرحلات
   * والمدفوعات والتقييمات والشكاوى وتذاكر الدعم وحالة الحجز في
   * استجابة واحدة. لا يعدّل أي بيانات.
   */
  async customer360(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        type: true,
        status: true,
        avatarUrl: true,
        locale: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const [
      totalTrips,
      completedTrips,
      cancelledTrips,
      spentAgg,
      ratingAgg,
      complaintsFrom,
      complaintsAgainst,
      ticketsOpen,
      ticketsTotal,
      activeHolds,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { passengerId: id } }),
      this.prisma.trip.count({
        where: { passengerId: id, status: "COMPLETED" },
      }),
      this.prisma.trip.count({
        where: { passengerId: id, status: "CANCELLED" },
      }),
      this.prisma.trip.aggregate({
        _sum: { fare: true },
        where: { passengerId: id, status: "COMPLETED" },
      }),
      this.prisma.rating.aggregate({
        _avg: { stars: true },
        _count: { _all: true },
        where: { targetId: id },
      }),
      this.prisma.complaint.count({ where: { fromUserId: id } }),
      this.prisma.complaint.count({ where: { againstUserId: id } }),
      this.prisma.supportTicket.count({
        where: { userId: id, status: { in: ["OPEN", "PENDING"] } },
      }),
      this.prisma.supportTicket.count({ where: { userId: id } }),
      this.prisma.riskHold.count({ where: { subjectId: id, active: true } }),
    ]);

    const [
      recentTrips,
      recentPayments,
      recentRatings,
      recentComplaints,
      recentTickets,
      holds,
    ] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { passengerId: id },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          rideClass: true,
          fare: true,
          currency: true,
          pickupAddress: true,
          destAddress: true,
          createdAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { userId: id },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          tripId: true,
          createdAt: true,
        },
      }),
      this.prisma.rating.findMany({
        where: { targetId: id },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          stars: true,
          comment: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      }),
      this.prisma.complaint.findMany({
        where: { OR: [{ fromUserId: id }, { againstUserId: id }] },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          message: true,
          status: true,
          fromUserId: true,
          againstUserId: true,
          createdAt: true,
        },
      }),
      this.prisma.supportTicket.findMany({
        where: { userId: id },
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          breached: true,
          createdAt: true,
        },
      }),
      this.prisma.riskHold.findMany({
        where: { subjectId: id, active: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reason: true,
          subjectKind: true,
          createdAt: true,
        },
      }),
    ]);

    const ledgerBalance = await this.financial.getUserBalance(id);

    return {
      profile: { ...user, ledgerBalance },
      trips: {
        total: totalTrips,
        completed: completedTrips,
        cancelled: cancelledTrips,
        totalSpent: Number(spentAgg._sum.fare ?? 0),
      },
      ratings: {
        average: ratingAgg._avg.stars
          ? Math.round(ratingAgg._avg.stars * 10) / 10
          : null,
        count: ratingAgg._count._all,
      },
      complaints: { submitted: complaintsFrom, against: complaintsAgainst },
      tickets: { open: ticketsOpen, total: ticketsTotal },
      risk: { activeHolds },
      recent: {
        trips: recentTrips,
        payments: recentPayments,
        ratings: recentRatings,
        complaints: recentComplaints,
        tickets: recentTickets,
        holds,
      },
    };
  }

  async trips(id: string, q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { passengerId: id },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.trip.count({ where: { passengerId: id } }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async getPassengerProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, type: UserType.PASSENGER },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        avatarUrl: true,
        locale: true,
        gender: true,
        onboardingCompletedAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException("Passenger profile not found");
    return {
      ...user,
      avatarUrl: await this.resolveAvatarUrl(user.avatarUrl),
      profileComplete: user.onboardingCompletedAt !== null,
    };
  }

  async updatePassengerProfile(userId: string, dto: UpdatePassengerProfileDto) {
    const current = await this.getPassengerProfile(userId);
    if (current.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("Account is not active");
    }
    // نفس تكلفة bcrypt المعتمدة في AuthService.register (10).
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : undefined;
    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone?.trim(),
          avatarUrl:
            dto.avatarUrl === undefined
              ? undefined
              : this.normalizeAvatarInput(dto.avatarUrl),
          locale: dto.locale?.trim(),
          gender: dto.gender,
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: { name: true, avatarUrl: true, locale: true, gender: true, onboardingCompletedAt: true },
      });
      // الصورة (avatarUrl) اختيارية لاكتمال الملف: يكفي الاسم + اللغة + الجنس.
      if (!updated.onboardingCompletedAt && updated.name.trim().length >= 2 && updated.locale && updated.gender) {
        await this.prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() } });
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Phone number is already registered");
      }
      throw error;
    }
    return this.getPassengerProfile(userId);
  }

  /**
   * يحوّل ما هو مخزّن في User.avatarUrl إلى رابط صالح للعرض.
   *
   * المخزّن هو مفتاح الكائن (object key) وليس رابطاً موقّعاً، لأن الروابط
   * الموقّعة تنتهي صلاحيتها. يُولّد الرابط عند القراءة عبر StorageService.readUrl
   * الموجودة أصلاً: تُرجِع الرابط العام الدائم من R2_PUBLIC_URL إن كان مضبوطاً،
   * وإلا فرابطاً موقّعاً مؤقتاً.
   *
   * القيم القديمة المخزّنة كروابط كاملة تُعاد كما هي (توافق خلفي).
   */
  private async resolveAvatarUrl(stored: string | null): Promise<string | null> {
    if (!stored) return null;
    if (/^https?:\/\//i.test(stored)) return stored;
    if (!this.storage.isEnabled()) return null;
    try {
      return await this.storage.readUrl(stored, AVATAR_READ_TTL_MINUTES);
    } catch {
      // تعذّر توليد الرابط لا يجب أن يُسقِط الملف الشخصي بأكمله.
      return null;
    }
  }

  /**
   * يقبل من العميل إمّا مفتاح الكائن مباشرة (المفضّل) أو رابطاً سبق أن
   * أرجعناه، ويخزّن المفتاح وحده دون توقيع ولا معاملات استعلام.
   */
  private normalizeAvatarInput(value: string): string {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^\/+/, "");
    let pathname: string;
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return trimmed;
    }
    const marker = pathname.indexOf(AVATAR_PREFIX);
    // روابط خارجية (مثل صورة من مزوّد آخر) تُحفظ كما هي.
    if (marker === -1) return trimmed;
    return pathname.slice(marker);
  }

  async createPassengerUploadUrl(userId: string, dto: PassengerUploadUrlDto) {
    await this.getPassengerProfile(userId);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException("File storage is not configured");
    }
    const contentType = dto.contentType ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new BadRequestException("Only profile images are allowed");
    }
    const ext = contentType.includes("png") ? "png" : "jpg";
    const objectPath = `passenger-profiles/${userId}/avatar.${ext}`;
    const uploadUrl = await this.storage.signedUploadUrl(
      objectPath,
      contentType,
    );
    // readUrl يُفضّل الرابط العام الدائم (R2_PUBLIC_URL) ويرجع للتوقيع المؤقّت إن لم
    // يكن مضبوطاً. العميل يحفظ objectPath في الملف الشخصي، ويستعمل readUrl للعرض فوراً.
    const readUrl = await this.storage.readUrl(objectPath, AVATAR_READ_TTL_MINUTES);
    return { uploadUrl, objectPath, readUrl, contentType };
  }

  getPassengerDeletionRequest(userId: string) {
    return this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
    });
  }

  async requestPassengerDeletion(userId: string, confirmation: string, reason?: string) {
    await this.getPassengerProfile(userId);
    const policy = await this.settings.getValue<{ enabled?: boolean; gracePeriodDays?: number; confirmationText?: string }>("passenger.accountDeletion");
    if (!policy?.enabled || !Number.isInteger(policy.gracePeriodDays) || !policy.confirmationText) {
      throw new BadRequestException("Account deletion is not configured");
    }
    if (policy.gracePeriodDays! < 1 || policy.gracePeriodDays! > 90 || confirmation !== policy.confirmationText) {
      throw new BadRequestException("Account deletion confirmation is invalid");
    }
    const existing = await this.getPassengerDeletionRequest(userId);
    if (existing) throw new ConflictException("Account deletion is already pending");
    const scheduledFor = new Date(Date.now() + policy.gracePeriodDays! * 86_400_000);
    const request = await this.prisma.accountDeletionRequest.create({
      data: { userId, scheduledFor, reason: reason?.trim() || null },
    });
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.deviceToken.deleteMany({ where: { userId } }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: "PASSENGER_ACCOUNT_DELETION_REQUESTED", entity: "AccountDeletionRequest", entityId: request.id, meta: { scheduledFor } } }),
    ]);
    return request;
  }

  async cancelPassengerDeletion(userId: string) {
    const request = await this.getPassengerDeletionRequest(userId);
    if (!request) throw new NotFoundException("Pending account deletion request not found");
    return this.prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
  }

  setStatus(id: string, status: UserStatus) {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }
}
