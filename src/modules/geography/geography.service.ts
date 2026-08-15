import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfigVersionService } from "../settings/config-version.service";
import {
  AssignCityWilayaDto,
  BulkAssignCitiesDto,
  CreateWilayaCityDto,
  UpdateWilayaDto,
} from "./dto/geography.dto";

/**
 * المرحلة 8 — خدمة الجغرافيا (الولايات ومدنها ومناطق التشغيل).
 *
 * حدود هذه الخدمة (مقصودة):
 * - لا تحسب مسافة ولا مدة ولا مسارًا. الولاية/المدينة تصنيف إداري وتسعيري
 *   وتشغيلي فقط. Google Routes وحده مسؤول عن distance/duration/polyline.
 * - لا تُنشئ ولا تحذف ولايات. الولايات بيانات مرجعية مصدرها
 *   prisma/data/algeria-wilayas.ts عبر الـseed القابل لإعادة التشغيل.
 */
@Injectable()
export class GeographyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
  ) {}

  // ==================== القراءة ====================

  /**
   * قائمة الولايات. الترتيب دائمًا بالرقم الرسمي لأنه الترتيب الذي يتوقعه
   * المستخدم الجزائري (01 أدرار … 69 الأبيض سيدي الشيخ)، وليس أبجديًا.
   */
  async listWilayas(opts: {
    activeOnly?: boolean;
    operationalOnly?: boolean;
    withCities?: boolean;
  }) {
    // نفس المرشّح ونفس الترتيب في الحالتين (لا تغير في النتيجة).
    const where = {
      ...(opts.activeOnly ? { isActive: true } : {}),
      ...(opts.operationalOnly ? { isOperational: true } : {}),
    };
    const orderBy = { number: "asc" } as const;
    // استدعاءان منفصلان بدل نشر include مشروط: Prisma يولّد نوع نتيجة
    // مختلفًا لكل شكل include، واتحاد الشكلين داخل وسيط واحد لا يمكن حلّه
    // ستاتيكيًا (من هنا خطأ _count/cities). المخرج JSON نفسه دون تغيير عقد API.
    if (opts.withCities) {
      return this.prisma.wilaya.findMany({
        where,
        orderBy,
        include: {
          cities: {
            where: opts.activeOnly ? { isActive: true } : undefined,
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              isActive: true,
              centerLat: true,
              centerLng: true,
            },
          },
        },
      });
    }
    return this.prisma.wilaya.findMany({
      where,
      orderBy,
      include: { _count: { select: { cities: true } } },
    });
  }

  async findWilaya(id: string) {
    const wilaya = await this.prisma.wilaya.findUnique({
      where: { id },
      include: {
        cities: { orderBy: { name: "asc" } },
        _count: { select: { cities: true, pricingRules: true } },
      },
    });
    if (!wilaya) throw new NotFoundException("الولاية غير موجودة");
    return wilaya;
  }

  /**
   * ما تطلبه التطبيقات: قائمة خفيفة، مناطق التشغيل فقط افتراضيًا.
   * لا ترجع حقولًا إدارية (عدد القواعد، تواريخ التعديل) لأن التطبيق لا يحتاجها.
   */
  async publicWilayas(operationalOnly = true) {
    const rows = await this.prisma.wilaya.findMany({
      where: {
        isActive: true,
        ...(operationalOnly ? { isOperational: true } : {}),
      },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        code: true,
        nameAr: true,
        nameFr: true,
        nameEn: true,
        centerLat: true,
        centerLng: true,
        isOperational: true,
      },
    });
    return { items: rows, count: rows.length };
  }

  /**
   * مدن التطبيقات. تقبل wilayaId أو wilayaNumber، لأن التطبيق قد يملك الرقم
   * الرسمي فقط (من وثيقة أو إدخال مستخدم) دون uuid.
   */
  async publicCities(params: { wilayaId?: string; wilayaNumber?: number }) {
    let wilayaId = params.wilayaId;
    if (!wilayaId && params.wilayaNumber) {
      const w = await this.prisma.wilaya.findUnique({
        where: { number: Number(params.wilayaNumber) },
        select: { id: true },
      });
      if (!w) throw new NotFoundException("الولاية غير موجودة");
      wilayaId = w.id;
    }

    const rows = await this.prisma.city.findMany({
      where: {
        isActive: true,
        ...(wilayaId ? { wilayaId } : {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        wilayaId: true,
        centerLat: true,
        centerLng: true,
      },
    });
    return { items: rows, count: rows.length };
  }

  // ==================== الإدارة ====================

  /**
   * تعديل ولاية: التفعيل، التشغيل، وتصحيح الإحداثيات فقط.
   * الأسماء والأرقام غير قابلة للتعديل من الواجهة لأنها بيانات قانونية رسمية.
   */
  async updateWilaya(id: string, dto: UpdateWilayaDto) {
    await this.findWilaya(id);

    // تعطيل ولاية يجب أن يوقف تشغيلها أيضًا، وإلا بقيت منطقة تشغيل "معطّلةتعمل".
    const nextActive = dto.isActive;
    const nextOperational =
      nextActive === false ? false : dto.isOperational;

    const updated = await this.prisma.wilaya.update({
      where: { id },
      data: {
        ...(nextActive !== undefined ? { isActive: nextActive } : {}),
        ...(nextOperational !== undefined
          ? { isOperational: nextOperational }
          : {}),
        ...(dto.centerLat !== undefined ? { centerLat: dto.centerLat } : {}),
        ...(dto.centerLng !== undefined ? { centerLng: dto.centerLng } : {}),
      },
    });

    // التطبيقات تخزن الجغرافيا مؤقتًا؛ رفع الإصدار يجبرها على إعادة الجلب.
    await this.versions.bump();
    return updated;
  }

  /** ربط مدينة واحدة بولاية (أو فك الربط) */
  async assignCity(cityId: string, dto: AssignCityWilayaDto) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) throw new NotFoundException("المدينة غير موجودة");

    if (dto.wilayaId) await this.findWilaya(dto.wilayaId);

    const updated = await this.prisma.city.update({
      where: { id: cityId },
      data: { wilayaId: dto.wilayaId ?? null },
    });
    await this.versions.bump();
    return updated;
  }

  /** إسناد جماعي — لتنظيف المدن القديمة التي لا ولاية لها بعد الترحيل */
  async bulkAssignCities(dto: BulkAssignCitiesDto) {
    if (!dto.cityIds?.length) {
      throw new BadRequestException("لم تُحدد أي مدينة");
    }
    if (dto.wilayaId) await this.findWilaya(dto.wilayaId);

    const result = await this.prisma.city.updateMany({
      where: { id: { in: dto.cityIds } },
      data: { wilayaId: dto.wilayaId ?? null },
    });
    await this.versions.bump();
    return { updated: result.count };
  }

  /** إنشاء مدينة داخل ولاية مباشرة من شاشة الجغرافيا */
  async createCityInWilaya(wilayaId: string, dto: CreateWilayaCityDto) {
    const wilaya = await this.findWilaya(wilayaId);

    const duplicate = await this.prisma.city.findFirst({
      where: {
        wilayaId,
        name: { equals: dto.name.trim(), mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException("المدينة موجودة مسبقًا في هذه الولاية");
    }

    const created = await this.prisma.city.create({
      data: {
        name: dto.name.trim(),
        country: "DZ",
        wilayaId,
        isActive: dto.isActive ?? true,
        // إن لم تُعطَ إحداثيات، نرث مركز الولاية كنقطة عرض مبدئية للخريطة فقط.
        centerLat: dto.centerLat ?? wilaya.centerLat,
        centerLng: dto.centerLng ?? wilaya.centerLng,
      },
    });
    await this.versions.bump();
    return created;
  }

  /**
   * تقرير التغطية: يستخدمه الداشبورد لإظهار ما يحتاج إلى عمل إداري،
   * وتحديدًا المدن الموروثة التي لم تُربط بعد بولاية.
   */
  async coverage() {
    const [totalWilayas, activeWilayas, operationalWilayas, unassignedCities] =
      await Promise.all([
        this.prisma.wilaya.count(),
        this.prisma.wilaya.count({ where: { isActive: true } }),
        this.prisma.wilaya.count({ where: { isOperational: true } }),
        this.prisma.city.findMany({
          where: { wilayaId: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, country: true, isActive: true },
        }),
      ]);

    return {
      totalWilayas,
      activeWilayas,
      operationalWilayas,
      unassignedCities,
      unassignedCitiesCount: unassignedCities.length,
      // تحذير صريح للإدارة بدل فشل صامت في التسعير لاحقًا.
      dataIntegrityNote:
        totalWilayas === 0
          ? "لم يُشغّل الـseed بعد: جدول الولايات فارغ. شغّل prisma db seed."
          : totalWilayas !== 69
            ? `عدد الولايات ${totalWilayas} وليس 69 — راجع الـseed.`
            : null,
    };
  }
}
