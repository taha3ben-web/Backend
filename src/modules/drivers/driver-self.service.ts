import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DriverAvailability, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { maskPhone } from "../calls/call-masking.adapter";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { DriverSanctionsService } from "./driver-sanctions.service";
import { ArrivalGuardService } from "../trips/arrival-guard.service";
import { ProfileLevelsService } from "../profile-levels/profile-levels.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { round2 } from "../../common/money.util";
import { identityChanged } from "./vehicle-verification.util";
import {
  AddDocumentDto,
  SetAvailabilityDto,
  UpdateDriverProfileDto,
  UploadUrlDto,
} from "./dto/driver-self.dto";

type DriverWithRelations = Prisma.DriverGetPayload<{
  include: {
    user: { select: { name: true; phone: true; email: true; avatarUrl: true } };
    vehicles: true;
    documents: true;
    city: { select: { id: true; name: true } };
    wilaya: {
      select: { id: true; number: true; nameAr: true; nameFr: true };
    };
  };
}>;

/**
 * نافذة رفع الوثيقة. الافتراضي في StorageService هو 15 دقيقة، وهي قصيرة
 * لسائق يصوّر رخصته على شبكة بطيئة ثم يعود للتطبيق.
 */
const DOCUMENT_UPLOAD_TTL_MINUTES = 30;

/**
 * خدمة الخدمة الذاتية للسائق (تطبيق السائق):
 * ملف السائق، مركبته النشطة، توفّره، أرباحه، رحلاته، ووثائقه.
 * كل العمليات تُشتق من userId المستخرج من الـ JWT، ولا يصل السائق لبيانات غيره.
 */
@Injectable()
export class DriverSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sanctions: DriverSanctionsService,
    // D-6: حراسة وقت الانتطار — نفس الخدمة المستخدمة في TripsService.
    private readonly arrivalGuard: ArrivalGuardService,
    // المرحلة 11: مستوى السائق ومستوى الراكب من مصدر واحد.
    @Inject(forwardRef(() => ProfileLevelsService))
    private readonly profileLevels: ProfileLevelsService,
  ) {}

  /** حالة عقوبات الإلغاء للسائق الحالي (مشتقة من userId الجلسة). */
  async sanctionStatus(userId: string) {
    const driver = await this.requireDriver(userId);
    return this.sanctions.getDriverSanctionStatus(driver.id);
  }

  private async requireDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException("ملف السائق غير موجود");
    return driver;
  }

  async getProfile(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        user: {
          select: { name: true, phone: true, email: true, avatarUrl: true },
        },
        vehicles: { where: { isActive: true }, take: 1 },
        documents: { orderBy: { createdAt: "desc" } },
        city: { select: { id: true, name: true } },
        // المرحلة ب: الولاية هي ما يختاره السائق عند التسجيل،
        // فلا يمكن للشاشة أن تعرض اختياره دون إرجاعه هنا.
        wilaya: {
          select: { id: true, number: true, nameAr: true, nameFr: true },
        },
      },
    });
    if (!driver) throw new NotFoundException("ملف السائق غير موجود");
    return this.serialize(driver as DriverWithRelations);
  }

  private async serialize(driver: DriverWithRelations) {
    const vehicle = driver.vehicles?.[0] ?? null;
    // قاعدة البيانات تحفظ مفتاح الكائن؛ رابط العرض يُولّد هنا عند كل طلب حتى
    // لا تموت صورة الوثيقة بعد انتهاء توقيع محفوظ.
    const documents = await Promise.all(
      (driver.documents ?? []).map(async (d) => ({
        id: d.id,
        type: d.type,
        url: await this.storage.resolveStoredUrl(
          d.url,
          STORED_MEDIA_READ_TTL_MINUTES,
        ),
        // المرحلة أ: وثيقة معتمدة انتهت مدتها تُعرض EXPIRED دون تغيير
        // المخزّن — نفس القاعدة المطبقة في تطبيق السائق.
        status:
          d.status === "APPROVED" &&
          d.expiresAt &&
          d.expiresAt.getTime() <= Date.now()
            ? ("EXPIRED" as const)
            : d.status,
        issuedAt: d.issuedAt ?? null,
        expiresAt: d.expiresAt ?? null,
        note: d.note ?? null,
      })),
    );
    const photoUrl =
      (await this.storage.resolveStoredUrl(
        driver.user?.avatarUrl ?? null,
        STORED_MEDIA_READ_TTL_MINUTES,
      )) ??
      documents.find((d) => d.type === "PROFILE_PHOTO")?.url ??
      null;
    // المرحلة 11 — عدّاد السائق مستقل تمامًا عن عدّاد الراكب.
    const level = await this.profileLevels.forDriver(driver.id);
    return {
      id: driver.id,
      userId: driver.userId,
      name: driver.user?.name ?? null,
      phone: driver.user?.phone ?? null,
      email: driver.user?.email ?? null,
      photoUrl,
      status: driver.status,
      approved: driver.status === "APPROVED",
      availability: driver.availability,
      rating: Number(driver.rating),
      totalTrips: driver.totalTrips,
      // المرحلة 11: العدد المشتق من الرحلات المكتملة فعليًا + المستوى + رابط الإطار.
      completedTripsCount: level.completedTripsCount,
      profileLevel: level.profileLevel,
      profileFrameUrl: level.profileFrameUrl,
      nextLevel: level.nextLevel,
      nextLevelAt: level.nextLevelAt,
      tripsToNextLevel: level.tripsToNextLevel,
      cityId: driver.cityId ?? null,
      city: driver.city?.name ?? null,
      // المرحلة ب: الولاية (المعتمدة في التسجيل) — الاسم بالعربية
      // والفرنسية لأن التطبيق أصبح بثلاث لغات.
      wilayaId: driver.wilayaId ?? null,
      wilaya: driver.wilaya
        ? {
            id: driver.wilaya.id,
            number: driver.wilaya.number,
            nameAr: driver.wilaya.nameAr,
            nameFr: driver.wilaya.nameFr,
          }
        : null,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color ?? null,
            plate: vehicle.plate,
            year: vehicle.year ?? null,
            rideClass: vehicle.rideClass,
            vehicleTypeId: vehicle.vehicleTypeId ?? null,
          }
        : null,
      documents,
    };
  }

  async updateProfile(userId: string, dto: UpdateDriverProfileDto) {
    const driver = await this.requireDriver(userId);

    if (dto.name || dto.phone) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name, phone: dto.phone },
      });
    }

    // ===== المرحلة ب: الصورة الشخصية تتغير فورًا =====
    // كان تغيير الصورة يمر عبر وثيقة PROFILE_PHOTO فتبقى PENDING حتى
    // يقبلها إداري، وهذا خاطئ: الأفاتار ليس وثيقة رسمية. يُكتب الآن
    // مباشرة على User.avatarUrl ويظهر فورًا للراكب والسائق.
    // مراجعة الهوية والمركبة تبقى كما هي.
    if (dto.photoUrl !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: dto.photoUrl || null },
      });
    }

    // ===== المرحلة ب: الولاية وحدها عند التسجيل =====
    // المدينة لم تعد تُطلب من السائق (قوائم المدن ناقصة في ولايات كثيرة)،
    // لكن cityId يبقى مقبولًا للتوافق مع النسخ القديمة من التطبيق.
    if (dto.wilayaId !== undefined) {
      if (dto.wilayaId) {
        const wilaya = await this.prisma.wilaya.findFirst({
          where: { id: dto.wilayaId, isActive: true },
          select: { id: true },
        });
        if (!wilaya) throw new BadRequestException("الولاية غير متاحة");
      }
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { wilayaId: dto.wilayaId || null },
      });
    }

    if (dto.cityId !== undefined) {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { cityId: dto.cityId || null },
      });
    }

    const touchesVehicle =
      dto.carMake !== undefined ||
      dto.carModel !== undefined ||
      dto.carColor !== undefined ||
      dto.carPlate !== undefined ||
      dto.carYear !== undefined ||
      dto.vehicleTypeId !== undefined;

    if (touchesVehicle) {
      const active = await this.prisma.vehicle.findFirst({
        where: { driverId: driver.id, isActive: true },
      });
      const model = dto.carModel ?? active?.model ?? "";
      const plate = (dto.carPlate ?? active?.plate ?? "").toUpperCase().trim();
      if (!model || !plate) {
        throw new BadRequestException("طراز المركبة ولوحة التسجيل مطلوبة");
      }
      // ===== المرحلة أ: نوع المركبة يختاره السائق قبل الاعتماد فقط =====
      // شاشة الوثائق في تطبيق السائق تطلب النوع (سيارة/دراجة نارية ثم
      // اقتصادية/confort/نسائية …) لأن قائمة الوثائق المطلوبة تعتمد عليه.
      // كان الحقل مرفوضًا بـ 400 (forbidNonWhitelisted) فبقي الاختيار محليًا.
      //
      // نقبله الآن بثلاث قيود، فالنوع يحدّد الطلبات التي تصل للسائق:
      //   1. المركبة المعتمدة لا يمكن إعادة تصنيفها من التطبيق (400).
      //   2. النوع يجب أن يكون موجودًا ومرئيًا للسائقين في اللوحة.
      //   3. الفئة (rideClass) تُشتق من النوع نفسه، لا يرسلها التطبيق.
      let requestedTypeId = active?.vehicleTypeId ?? null;
      let requestedRideClass = active?.rideClass ?? "ECONOMY";
      if (dto.vehicleTypeId !== undefined) {
        const nextTypeId = dto.vehicleTypeId || null;
        if (
          nextTypeId !== (active?.vehicleTypeId ?? null) &&
          active?.verificationStatus === "APPROVED"
        ) {
          throw new BadRequestException(
            "لا يمكن تغيير نوع المركبة بعد اعتمادها — راسل الدعم لإعادة التصنيف",
          );
        }
        if (nextTypeId) {
          const type = await this.prisma.vehicleType.findFirst({
            where: { id: nextTypeId, isActive: true, visibleToDrivers: true },
            select: { id: true, rideClass: true },
          });
          if (!type) {
            throw new BadRequestException("نوع المركبة غير متاح");
          }
          requestedTypeId = type.id;
          requestedRideClass = type.rideClass;
        } else {
          requestedTypeId = null;
        }
      }

      const data = {
        make: dto.carMake ?? active?.make ?? model,
        model,
        color: dto.carColor ?? active?.color ?? null,
        plate,
        year: dto.carYear ?? active?.year ?? null,
        // الفئة تتبع النوع المختار (أو تبقى كما هي)، والاعتماد النهائي
        // للإدارة عبر PATCH /vehicles/:id/verify.
        rideClass: requestedRideClass,
        vehicleTypeId: requestedTypeId,
      };
      const typeChanged =
        (active?.vehicleTypeId ?? null) !== (requestedTypeId ?? null);
      if (active) {
        // عند تغيّر هوية المركبة (الصانع/الطراز/اللوحة/السنة) يُعاد ضبط التحقق للمراجعة.
        const resetVerification = identityChanged(active, data) || typeChanged
          ? {
              verificationStatus: "PENDING" as const,
              verificationNote: null,
              verifiedById: null,
              verifiedAt: null,
            }
          : {};
        await this.prisma.vehicle.update({
          where: { id: active.id },
          data: { ...data, ...resetVerification },
        });
      } else {
        await this.prisma.vehicle.create({
          data: { driverId: driver.id, isActive: true, ...data },
        });
      }
    }

    return this.getProfile(userId);
  }

  /**
   * ===== المرحلة أ: صدارة السائقين (المدينة / الجزائر كاملة) =====
   *
   * شاشة الطبقات في تطبيق السائق كانت تعرض حالة فارغة لأن هذه النقطة
   * لم تكن موجودة إطلاقًا.
   *
   * الترتيب مشتق من الرحلات المكتملة فعليًا (COMPLETED) لا من totalTrips
   * المخزّن، لأن الأخير عدّاد تشغيلي قد يتقدم بلا رحلة مكتملة؛ وهو
   * نفس المصدر الذي تبنى عليه مستويات الملف (ProfileLevelsService)، فلا يرى
   * السائق رقمين متعارضين في شاشتين.
   *
   * السائقون المعتمدون فقط (APPROVED)، والرتبة تُحسب على القائمة الكاملة
   * قبل الاقتطاع، حتى يعرف من هو خارج العشرة الأولى مرتبته الحقيقية.
   * لا أرقام مخترعة ولا مراكز تجريبية.
   */
  async leaderboard(userId: string, scopeRaw?: string, limitRaw?: number) {
    const driver = await this.requireDriver(userId);
    const scope = scopeRaw === "country" ? "country" : "city";
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 5), 50);

    // سائق بلا مدينة لا يمكن ترتيبه محليًا: نقول ذلك صراحة بدل قائمة مضلّلة.
    if (scope === "city" && !driver.cityId) {
      return {
        scope,
        period: "ALL_TIME",
        available: false,
        rows: [],
        me: null,
      };
    }

    const peers = await this.prisma.driver.findMany({
      where: {
        status: "APPROVED",
        ...(scope === "city" ? { cityId: driver.cityId } : {}),
      },
      select: {
        id: true,
        rating: true,
        city: { select: { name: true } },
        user: { select: { name: true, avatarUrl: true } },
      },
      // حدّ أمان لحجم الاستعلام التالي.
      take: 1000,
    });

    if (peers.length === 0) {
      return { scope, period: "ALL_TIME", available: true, rows: [], me: null };
    }

    const counts = await this.prisma.trip.groupBy({
      by: ["driverId"],
      where: {
        status: "COMPLETED",
        driverId: { in: peers.map((p) => p.id) },
      },
      _count: { _all: true },
    });
    const countBy = new Map<string, number>();
    for (const row of counts) {
      if (row.driverId) countBy.set(row.driverId, row._count._all);
    }

    const ranked = peers
      .map((p) => ({
        driverId: p.id,
        name: p.user?.name ?? null,
        avatarKey: p.user?.avatarUrl ?? null,
        cityName: p.city?.name ?? null,
        rating: Number(p.rating),
        score: countBy.get(p.id) ?? 0,
      }))
      // التعادل يُفصل بالتقييم ثم بالمعرّف لترتيب ثابت لا يرتجف بين الطلبات.
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.rating - a.rating ||
          a.driverId.localeCompare(b.driverId),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const mine = ranked.find((row) => row.driverId === driver.id) ?? null;
    const top = ranked.slice(0, limit);

    const resolve = async (row: (typeof ranked)[number]) => ({
      rank: row.rank,
      driverId: row.driverId,
      name: row.name,
      photoUrl: await this.storage.resolveStoredUrl(
        row.avatarKey,
        STORED_MEDIA_READ_TTL_MINUTES,
      ),
      cityName: row.cityName,
      score: row.score,
      scoreUnit: "رحلة",
      rating: row.rating,
      isMe: row.driverId === driver.id,
    });

    return {
      scope,
      period: "ALL_TIME",
      available: true,
      total: ranked.length,
      rows: await Promise.all(top.map(resolve)),
      me: mine ? await resolve(mine) : null,
    };
  }

  async setAvailability(userId: string, dto: SetAvailabilityDto) {
    const driver = await this.requireDriver(userId);
    if (dto.availability === "ONLINE" && driver.status !== "APPROVED") {
      throw new ForbiddenException("لا يمكنك الاتصال قبل اعتماد حسابك");
    }
    if (driver.availability === "ON_TRIP") {
      throw new BadRequestException("لا يمكن تغيير الحالة أثناء رحلة نشطة");
    }
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        availability: dto.availability as DriverAvailability,
        lastSeenAt: new Date(),
      },
    });
    return { availability: dto.availability };
  }

  async earnings(userId: string) {
    const driver = await this.requireDriver(userId);
    const items = await this.prisma.driverEarning.findMany({
      where: { driverId: driver.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        trip: {
          select: {
            id: true,
            destAddress: true,
            distanceKm: true,
            rideClass: true,
            completedAt: true,
          },
        },
      },
    });

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));

    let today = 0;
    let week = 0;
    let all = 0;
    for (const e of items) {
      const net = Number(e.net);
      all += net;
      if (e.createdAt >= startOfDay) today += net;
      if (e.createdAt >= startOfWeek) week += net;
    }
    return {
      totals: {
        today: round2(today),
        week: round2(week),
        all: round2(all),
        trips: driver.totalTrips,
      },
      items: items.map((e) => ({
        id: e.id,
        tripId: e.tripId,
        gross: Number(e.gross),
        commission: Number(e.commission),
        net: Number(e.net),
        createdAt: e.createdAt,
        trip: e.trip,
      })),
    };
  }

  async trips(userId: string, q: PaginationDto) {
    const driver = await this.requireDriver(userId);
    const where: Prisma.TripWhereInput = { driverId: driver.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { passenger: { select: { name: true } } },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }


  async trip(userId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { passenger: { select: { name: true, phone: true, avatarUrl: true } } } });
    const driver = await this.requireDriver(userId);
    if (!trip || trip.driverId !== driver.id) throw new NotFoundException("الرحلة غير موجودة");
    // السائق لا يرى رقم الراكب الحقيقي أبدًا.
    // المرحلة 11: مستوى الراكب وإطاره يأتيان جاهزين من الخادم لعرضهما ف��
    // بطاقة الرحلة دون أي حساب داخل تطبيق السائق.
    const passengerLevel = await this.profileLevels.forPassenger(
      trip.passengerId,
    );
    return {
      ...trip,
      passenger: trip.passenger
        ? {
            ...trip.passenger,
            phone: maskPhone(trip.passenger.phone),
            avatarUrl: await this.storage.resolveStoredUrl(
              trip.passenger.avatarUrl,
              STORED_MEDIA_READ_TTL_MINUTES,
            ),
            completedTripsCount: passengerLevel.completedTripsCount,
            profileLevel: passengerLevel.profileLevel,
            profileFrameUrl: passengerLevel.profileFrameUrl,
          }
        : trip.passenger,
    };
  }

  async updateTripStatus(userId: string, tripId: string, status: "ARRIVING" | "IN_PROGRESS" | "COMPLETED", reason?: string) {
    const driver = await this.requireDriver(userId); const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.driverId !== driver.id) throw new NotFoundException("الرحلة غير موجودة");
    const allowed = (trip.status === "ACCEPTED" && status === "ARRIVING") || (trip.status === "ARRIVING" && status === "IN_PROGRESS") || (trip.status === "IN_PROGRESS" && status === "COMPLETED");
    if (!allowed) throw new BadRequestException(`Invalid transition ${trip.status} -> ${status}`);
    // D-6 — لا يُسمح بتسجيل الوصول إلا داخل نصف القطر (موقع الخادم، fail-closed).
    if (status === "ARRIVING") {
      await this.arrivalGuard.assertCanMarkArriving({
        tripId,
        driverUserId: userId,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
      });
    }
    const changed = await this.prisma.trip.updateMany({ where: { id: tripId, status: trip.status }, data: { status, startedAt: status === "IN_PROGRESS" ? new Date() : undefined, completedAt: status === "COMPLETED" ? new Date() : undefined, cancelReason: reason } });
    if (changed.count !== 1) throw new BadRequestException("Trip state changed concurrently");
    // المرحلة 11 — مسار إكمال قائم ثانٍ (PATCH /driver/me/trips/:id/status).
    // الحارس updateMany أعلاه يضمن أن الانتقال حدث مرة واحدة، والحساب
    // مشتق من عدّ الرحلات فل�� يمكن احتساب الإكمال مرتين أصلًا.
    if (status === "COMPLETED") {
      void this.profileLevels.onTripCompleted(tripId).catch(() => undefined);
    }
    return this.prisma.trip.findUnique({ where: { id: tripId } });
  }

  async addDocument(userId: string, dto: AddDocumentDto) {
    const driver = await this.requireDriver(userId);
    // يُقبل مفتاح الكائن أو رابط سبق أن أرجعناه، ويُخزَّن المفتاح وحده: لا
    // توقيع ولا معاملات استعلام تنتهي صلاحيتها داخل قاعدة البيانات.
    const created = await this.prisma.driverDocument.create({
      data: {
        driverId: driver.id,
        type: dto.type,
        url: this.storage.toObjectPath(dto.url),
        status: "PENDING",
        // المرحلة أ: تاريخا الوثيقة كما أدخلهما السائق. كانا يُرسلان من
        // التطبيق ويُتجاهلان هنا، فلم تكن اللوحة تعرف متى تنتهي الوثيقة.
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return {
      ...created,
      url: await this.storage.resolveStoredUrl(
        created.url,
        STORED_MEDIA_READ_TTL_MINUTES,
      ),
    };
  }

  async createUploadUrl(userId: string, dto: UploadUrlDto) {
    const driver = await this.requireDriver(userId);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException("خدمة التخزين غير مفعّلة على الخادم");
    }
    const contentType = dto.contentType ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const objectPath = `driver-docs/${driver.id}/${dto.kind}-${Date.now()}.${ext}`;
    const uploadUrl = await this.storage.signedUploadUrl(
      objectPath,
      contentType,
      DOCUMENT_UPLOAD_TTL_MINUTES,
    );
    // readUrl (لا signedReadUrl) تحترم R2_PUBLIC_URL فتُرجِع رابطاً عاماً دائماً
    // عند ضبطه. وهو للعرض الفوري فقط؛ المخزَّن في قاعدة البيانات هو objectPath.
    const readUrl = await this.storage.readUrl(
      objectPath,
      STORED_MEDIA_READ_TTL_MINUTES,
    );
    return { uploadUrl, objectPath, readUrl };
  }
}
