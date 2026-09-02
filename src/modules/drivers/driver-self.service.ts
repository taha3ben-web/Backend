import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { DriverAvailability, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { maskPhone } from "../calls/call-masking.adapter";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { DriverSanctionsService } from "./driver-sanctions.service";
import { ArrivalGuardService } from "../trips/arrival-guard.service";
import { ProfileLevelsService } from "../profile-levels/profile-levels.service";
import {
  PROFILE_LEVEL_COMMON_BENEFITS,
  profileLevelLadder,
  profileLevelProgressPercent,
} from "../profile-levels/profile-level.util";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { round2 } from "../../common/money.util";
import { RequirementsService } from "../vehicle-types/requirements.service";
import { identityChanged } from "./vehicle-verification.util";
import { LeaderboardService } from "./leaderboard.service";
import {
  AddDocumentDto,
  DOC_TYPES,
  REQUIRED_DRIVER_DOC_TYPES,
  SetAvailabilityDto,
  UpdateDriverProfileDto,
  UploadUrlDto,
} from "./dto/driver-self.dto";

type DriverWithRelations = Prisma.DriverGetPayload<{
  include: {
    user: {
      select: {
        name: true;
        phone: true;
        email: true;
        avatarUrl: true;
        // المرحلة ج: لازمان لحساب hasPassword دون عمود جديد.
        firebaseUid: true;
        passwordHash: true;
      };
    };
    vehicles: {
      include: {
        vehicleType: {
          select: {
            id: true;
            name: true;
            nameI18n: true;
            requiredDocuments: true;
          };
        };
      };
    };
    documents: true;
    city: { select: { id: true; name: true } };
    wilaya: {
      select: {
        id: true;
        number: true;
        nameAr: true;
        nameFr: true;
        nameEn: true;
      };
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
    // المرحلة و: إعادة استعمال خدمة المتطلبات القائمة بدل بناء نظام فحص ثانٍ.
    private readonly requirements: RequirementsService,
    // محرّك الصدارة: الترتيب والمعاملات في مكان واحد. لا خطر دائري:
    // LeaderboardService لا يعتمد على DriverSelfService إطلاقًا.
    private readonly leaderboardEngine: LeaderboardService,
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
          select: {
            name: true,
            phone: true,
            email: true,
            avatarUrl: true,
            // المرحلة ج: hasPassword يُحسب من هذين الحقلين، بلا عمود جديد
            // وبلا ترحيل. لا يُرجَع أي منهما للتطبيق أبدًا.
            firebaseUid: true,
            passwordHash: true,
          },
        },
        // المرحلة ج: نوع المركبة المختار يحدّد الوثائق الإلزامية، فلا يجوز
        // أن يحسبها التطبيق من قائمة ثابتة عنده.
        vehicles: {
          where: { isActive: true },
          take: 1,
          include: {
            vehicleType: {
              select: {
                id: true,
                name: true,
                nameI18n: true,
                requiredDocuments: true,
              },
            },
          },
        },
        documents: { orderBy: { createdAt: "desc" } },
        city: { select: { id: true, name: true } },
        // المرحلة ب: الولاية هي ما يختاره السائق عند التسجيل،
        // فلا يمكن للشاشة أن تعرض اختياره دون إرجاعه هنا.
        // المرحلة ج: nameEn أُضيف لأن التطبيق بثلاث لغات.
        wilaya: {
          select: {
            id: true,
            number: true,
            nameAr: true,
            nameFr: true,
            nameEn: true,
          },
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

    // ===== المرحلة ج (1): هل للحساب كلمة مرور فعلًا؟ =====
    // حارس التسجيل في التطبيق لم يكن يقدر على فحص خطوة كلمة المرور،
    // فكان إما يتجاوزها دائمًا أو يُرجع السائق للنموذج عند كل فتح.
    //
    // لا عمود جديد ولا ترحيل: دخول Firebase يكتب بصمة معروفة
    // (bcrypt لـ "firebase:<uid>") في AuthService، فمطابقتها تعني أن الحساب
    // بلا كلمة مرور حقيقية. والفشل يُقرأ "لديه كلمة مرور" (fail-closed)
    // لأن الأسوأ هو إعادة سائق مكتمل الملف إلى نموذج لا يخرج منه.
    const hasPassword = await this.computeHasPassword(
      driver.user?.firebaseUid ?? null,
      driver.user?.passwordHash ?? null,
    );

    // ===== المرحلة ج (2): الوثائق الإلزامية يقررها الخادم =====
    // كان التطبيق يحسب القائمة من ثابت محلي ويفتح زر "متابعة" عليه،
    // فكان ممكنًا أن يضيف مدير اللوحة وثيقة لنوع مركبة ولا يعلم التطبيق بها.
    // القاعدة: الأرضية المشتركة (REQUIRED_DRIVER_DOC_TYPES) مع وثائق النوع
    // المختار (VehicleType.requiredDocuments — تُدار من اللوحة).
    const documentRequirements = this.buildDocumentRequirements(
      vehicle?.vehicleType?.requiredDocuments ?? [],
      documents,
    );

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
            nameEn: driver.wilaya.nameEn,
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
            // المرحلة ج: اسم النوع كما في اللوحة (مع ترجماته إن وُجدت)،
            // حتى تعرض شاشة المركبة نوعها دون استدعاء الكتالوج كله.
            vehicleTypeName: vehicle.vehicleType?.name ?? null,
            vehicleTypeNameI18n: vehicle.vehicleType?.nameI18n ?? null,
          }
        : null,
      documents,
      // المرحلة ج: حقيقتان كان التطبيق يخمّنهما.
      hasPassword,
      documentRequirements,
    };
  }

  /**
   * ===== المرحلة ج: هل وُضعت كلمة مرور حقيقية للحساب؟ =====
   *
   * دخول Firebase ينشئ المستخدم بـ passwordHash غير قابل للاستخدام قيمته
   * bcrypt("firebase:<uid>") — انطباقها ليس تخمينًا بل مقارنة مع نفس القيمة
   * التي يكتبها AuthService.
   *
   * لا تُرجع البصمة ولا معرّف Firebase للعميل أبدًا؛ المخرج بوليان واحد.
   */
  private async computeHasPassword(
    firebaseUid: string | null,
    passwordHash: string | null,
  ): Promise<boolean> {
    // لا بصمة أصلًا = لا يمكن الدخول بكلمة مرور.
    if (!passwordHash) return false;
    // حساب أُنشئ بالتسجيل العادي (بلا Firebase) له كلمة مرور بالتعريف.
    if (!firebaseUid) return true;
    try {
      const isSentinel = await bcrypt.compare(
        `firebase:${firebaseUid}`,
        passwordHash,
      );
      return !isSentinel;
    } catch {
      // fail-closed: لا نطلب كلمة مرور من سائق ربما وضعها فعلًا.
      return true;
    }
  }

  /**
   * ===== المرحلة ج: ما يحجب ملف السائق من وثائق =====
   *
   * المطلوب = الأرضية المشتركة + وثائق نوع المركبة المختار.
   * وثائق النوع تُرشّح إلى قيم DocumentType الحقيقية فقط: مدير اللوحة
   * يكتبها نصًا حرًا (String[])، وقيمة مطبعية لا يجوز أن تحجب سائقًا بوثيقة
   * لا يملك أصلًا خانة لرفعها. المرفوضة والمنتهية ناقصة، والمعلّقة
   * (PENDING) ليست ناقصة — طلب رفعها مرة أخرى ينتج نسخًا مكررة فقط.
   */
  private buildDocumentRequirements(
    typeRequiredRaw: string[],
    documents: Array<{ type: string; status: string }>,
  ) {
    const known = new Set<string>(DOC_TYPES as readonly string[]);
    const base = REQUIRED_DRIVER_DOC_TYPES as readonly string[];

    const fromType: string[] = [];
    const unsupportedFromType: string[] = [];
    for (const raw of typeRequiredRaw) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      if (!known.has(value)) {
        // قيمة لا يعرفها المخطط: تُعلن للوضوح ولا تحجب.
        if (!unsupportedFromType.includes(value)) {
          unsupportedFromType.push(value);
        }
        continue;
      }
      if (!base.includes(value) && !fromType.includes(value)) {
        fromType.push(value);
      }
    }

    const required = [...base, ...fromType];

    // أحدث حالة لكل نوع: الوثائق مرتّبة تنازليًا بتاريخ الإنشاء.
    const latestStatus = new Map<string, string>();
    for (const document of documents) {
      if (!latestStatus.has(document.type)) {
        latestStatus.set(document.type, document.status);
      }
    }

    const missing = required.filter((type) => {
      const status = latestStatus.get(type);
      return !status || status === "REJECTED" || status === "EXPIRED";
    });

    return {
      required,
      // من أين جاء كل شرط، حتى تعرف الواجهة ما أضافه النوع.
      baseRequired: [...base],
      typeRequired: fromType,
      missing,
      complete: missing.length === 0,
      unsupportedFromType,
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
        const resetVerification =
          identityChanged(active, data) || typeChanged
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
   * ===== صدارة السائقين — العقد المنشور ("GET /api/driver/leaderboard") =====
   *
   * الحساب انتقل إلى LeaderboardService. النسخة السابقة كانت تجلب `take: 1000`
   * سائق **بلا orderBy** ثم ترتّبهم في Node، وهذا يعني أربعة أعطاب حقيقية:
   *   1. على مستوى الجزائر كان "المتصدرون" أول ألف صف ترجعه القاعدة، لا الأعلى نقاطًا.
   *   2. بلا orderBy فالعينة نفسها تختلف بين طلبين — ترتيب يرتجف.
   *   3. سائق خارج الألف لا يرى مرتبته إطلاقًا (me = null).
   *   4. المعادلة مدفونة في الكود فلا يملكها العمل.
   *
   * المحرك الجديد يرتّب في PostgreSQL (ROW_NUMBER/COUNT OVER) على كل المؤهلين،
   * ويقرأ المعاملات من جدول Setting (مفتاح "driver.leaderboard") فيملكها العمل.
   *
   * شكل الرد محفوظ بحرفه (scope | localBasis | period | available | total |
   * rows[] | me، وكل صف فيه rank | driverId | name | photoUrl | cityName | score |
   * scoreUnit | rating | isMe) وأُضيفت حقول جديدة فقط، فالتطبيق المنشور
   * يعمل كما هو. التفاصيل الكاملة في "GET /driver/leaderboard/summary".
   */
  async leaderboard(userId: string, scopeRaw?: string, limitRaw?: number) {
    return this.leaderboardEngine.legacyView(userId, scopeRaw, limitRaw);
  }

  /**
   * المرحلة د — شاشة الطبقات والترقية ("GET /api/driver/me/tier").
   *
   * كان مستوى السائق يُرجَع داخل "GET /driver/me" وحده: الطبقة الحالية فقط،
   * بلا سلّم ولا عتبات ولا مزايا. فكانت الشاشة غير قابلة للبناء إلا بكتابة
   * العتبات داخل التطبيق، وهو ما يخالف شرط "الطبقات من الخادم لا أرقام وهمية".
   *
   * الحساب كله يعيد استخدام ProfileLevelsService و profile-level.util الموجودين:
   * لا نظام طبقات ثانٍ ولا عتبات مكرّرة.
   *
   * الترتيب (rank) مقصود ألّا يكون هنا: "GET /driver/leaderboard" يُرجعه أصلًا
   * في me.rank، وتكراره يعني استعلام 1000 سائق مرتين لنفس الشاشة.
   *
   * system يُعلَن صراحةً لأن في الخادم نظامَين مختلفين تتشابه أسماء درجاتهما:
   * هذا (رحلات مكتملة) و"/api/loyalty/me" (نقاط، وفيه PLATINUM لا DIAMOND).
   * توكن السائق يستطيع الوصول إليهما معًا، فوجب تمييز المصدر لا دمجهما.
   */
  async tier(userId: string) {
    const driver = await this.requireDriver(userId);
    const level = await this.profileLevels.forDriver(driver.id);
    const ladder = profileLevelLadder(level.completedTripsCount);

    // روابط الإطارات تُولَّد في الخدمة عبر StorageService، لأن util نقيّ
    // ولا يعرف R2 ولا مدة صلاحية الرابط.
    const steps = await Promise.all(
      ladder.map(async (step) => ({
        level: step.level,
        minCompletedTrips: step.minCompletedTrips,
        frameUrl: await this.storage.resolveStoredUrl(
          step.frameKey,
          STORED_MEDIA_READ_TTL_MINUTES,
        ),
        benefits: step.benefits,
        isCurrent: step.isCurrent,
        isReached: step.isReached,
        tripsRemaining: step.tripsRemaining,
      })),
    );

    return {
      system: "PROFILE_LEVELS",
      completedTripsCount: level.completedTripsCount,
      profileLevel: level.profileLevel,
      profileFrameUrl: level.profileFrameUrl,
      nextLevel: level.nextLevel,
      nextLevelAt: level.nextLevelAt,
      tripsToNextLevel: level.tripsToNextLevel,
      progressPercent: profileLevelProgressPercent(level.completedTripsCount),
      commonBenefits: PROFILE_LEVEL_COMMON_BENEFITS,
      ladder: steps,
    };
  }

  /**
   * ===== المرحلة و: أهلية السائق لنوع مركبة =====
   *
   * `RequirementsService.verify()` موجود وسليم ويفحص التقييم والرحلات وسنة
   * الصنع والرخصة والمستندات والصور الإلزامية، لكنه كان متاحًا عبر مسار واحد:
   * `GET /api/vehicle-types/:id/verify/:driverId` وهو **للموظفين فقط**
   * (`@Roles("STAFF")` + `pricing.manage`/`settings.manage`).
   *
   * أي أن السائق نفسه لم يكن يستطيع معرفة سبب عدم أهليته: يختار النوع،
   * ويرفع الوثائق، وينتظر، ثم يُرفض من اللوحة بلا سبب مفهوم. و`PATCH /driver/me`
   * يتحقق من وجود النوع وظهوره للسائقين فقط، ولا يفحص المتطلبات إطلاقًا.
   *
   * **لماذا لا يمنع الاختيار:** فحوص المستندات في `verify()` تشترط `APPROVED`،
   * ولا وثيقة واحدة تكون `APPROVED` قبل مراجعة اللوحة. فلو ربطنا اختيار النوع
   * بـ `eligible === true` لاستحال التسجيل على كل سائق جديد: يحتاج النوع ليعرف الوثائق
   * المطلوبة، ويحتاج الوثائق معتمدة ليأخذ النوع. دورة مغلقة. لذلك تفصل هذه
   * الدالة الفحوص إلى مجموعات: موضوعية مانعة (تقييم/رحلات/سنة صنع) — وهي لا تعتمد
   * على موافقة أحد — ومجموعات مستندية تُعرض كخطوات لا كرفض.
   *
   * والبوّابة الحقيقية تبقى كما هي: `setAvailability(ONLINE)` يشترط `APPROVED`،
   * والاعتماد النهائي للوحة عبر `PATCH /vehicles/:id/verify`. لم يُمسّ أي منهما.
   */
  async vehicleTypeEligibility(userId: string, vehicleTypeId: string) {
    const driver = await this.requireDriver(userId);
    // السائق يُسأل عن الأنواع المرئية له وحدها، فلا يستكشف أنواعًا مخفية في اللوحة.
    const type = await this.prisma.vehicleType.findFirst({
      where: { id: vehicleTypeId, isActive: true, visibleToDrivers: true },
      select: { id: true, name: true, nameI18n: true, rideClass: true },
    });
    if (!type) throw new BadRequestException("نوع المركبة غير متاح");

    const report = await this.requirements.verify(type.id, driver.id);

    // حالات الوثائق الفعلية للتمييز بين "لم تُرفع" و"مرفوعة وتنتظر المراجعة"
    // و"مرفوضة/منتهية تحتاج إعادة رفع". `verify()` يعرف APPROVED وحدها.
    const docs = await this.prisma.driverDocument.findMany({
      where: { driverId: driver.id },
      select: { type: true, status: true },
    });
    const statusesByType = new Map<string, string[]>();
    for (const doc of docs) {
      const key = String(doc.type);
      const list = statusesByType.get(key);
      if (list) list.push(String(doc.status));
      else statusesByType.set(key, [String(doc.status)]);
    }

    const OBJECTIVE_KEYS = new Set([
      "minDriverRating",
      "minDriverTrips",
      "minVehicleYear",
    ]);

    const blocking: typeof report.checks = [];
    const awaitingApproval: string[] = [];
    const actionRequired: string[] = [];
    const missingDocuments: string[] = [];

    for (const check of report.checks) {
      if (check.ok) continue;
      if (OBJECTIVE_KEYS.has(check.key)) {
        blocking.push(check);
        continue;
      }
      // فحوص مستندية: document:*، photo:*، requiredLicenseType
      const docType =
        check.key === "requiredLicenseType"
          ? "LICENSE"
          : String(check.required);
      const statuses = statusesByType.get(docType) ?? [];
      if (statuses.length === 0) missingDocuments.push(docType);
      else if (statuses.includes("PENDING")) awaitingApproval.push(docType);
      else actionRequired.push(docType);
    }

    return {
      vehicleTypeId: type.id,
      vehicleTypeName: type.name,
      vehicleTypeNameI18n: type.nameI18n,
      rideClass: type.rideClass,
      // مطابق تمامًا لما تراه اللوحة عبر مسار الموظفين، من نفس الخدمة.
      eligible: report.eligible,
      // هل يجوز للسائق اختيار هذا النوع الآن؟ المستندات تُراجع لاحقًا،
      // أما الفحوص الموضوعية فلا يغيرها أي رفع وثائق.
      selectable: blocking.length === 0,
      checks: report.checks,
      blocking,
      awaitingApproval,
      actionRequired,
      missingDocuments,
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
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        passenger: { select: { name: true, phone: true, avatarUrl: true } },
      },
    });
    const driver = await this.requireDriver(userId);
    if (!trip || trip.driverId !== driver.id)
      throw new NotFoundException("الرحلة غير موجودة");
    // السائق لا يرى رقم الراكب الحقيقي أبدًا.
    // المرحلة 11: مستوى الراكب وإطاره يأتيان جاهزين من الخادم لعرضهما في
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

  async updateTripStatus(
    userId: string,
    tripId: string,
    status: "ARRIVING" | "IN_PROGRESS" | "COMPLETED",
    reason?: string,
  ) {
    const driver = await this.requireDriver(userId);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.driverId !== driver.id)
      throw new NotFoundException("الرحلة غير موجودة");
    const allowed =
      (trip.status === "ACCEPTED" && status === "ARRIVING") ||
      (trip.status === "ARRIVING" && status === "IN_PROGRESS") ||
      (trip.status === "IN_PROGRESS" && status === "COMPLETED");
    if (!allowed)
      throw new BadRequestException(
        `Invalid transition ${trip.status} -> ${status}`,
      );
    // D-6 — لا يُسمح بتسجيل الوصول إلا داخل نصف القطر (موقع الخادم، fail-closed).
    if (status === "ARRIVING") {
      await this.arrivalGuard.assertCanMarkArriving({
        tripId,
        driverUserId: userId,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
      });
    }
    const changed = await this.prisma.trip.updateMany({
      where: { id: tripId, status: trip.status },
      data: {
        status,
        startedAt: status === "IN_PROGRESS" ? new Date() : undefined,
        completedAt: status === "COMPLETED" ? new Date() : undefined,
        cancelReason: reason,
      },
    });
    if (changed.count !== 1)
      throw new BadRequestException("Trip state changed concurrently");
    // المرحلة 11 — مسار إكمال قائم ثانٍ (PATCH /driver/me/trips/:id/status).
    // الحارس updateMany أعلاه يضمن أن الانتقال حدث مرة واحدة، والحساب
    // مشتق من عدّ الرحلات فلا يمكن احتساب الإكمال مرتين أصلًا.
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
