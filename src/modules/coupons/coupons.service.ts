import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Coupon, CouponFundingSource, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateCouponDto, UpdateCouponDto } from "./dto/coupons.dto";
import { round2 } from "../../common/money.util";
import { SettingsService } from "../settings/settings.service";

export interface CouponResult {
  coupon: Coupon;
  discount: number;
  finalFare: number;
  fundingSource: CouponFundingSource;
  platformShare: number;
}

/**
 * سياق الرحلة اللازم لتقييدات الكوبون (الفئة/المدينة).
 * يأتي دائمًا من الخادم (من عرض السعر المحسوب)، لا من جسم الطلب مباشرة.
 */
export interface CouponContext {
  rideClass?: string | null;
  cityId?: string | null;
}

/** مفتاح الإعداد العام لسياسة تمويل الكوبونات (يُدار من لوحة التحكم). */
export const COUPON_FUNDING_SETTING_KEY = "coupons.funding";
const DEFAULT_COUPON_FUNDING: {
  source: CouponFundingSource;
  platformShare: number;
} = { source: "PLATFORM", platformShare: 0.5 };

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async create(dto: CreateCouponDto): Promise<Coupon> {
    const exists = await this.prisma.coupon.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    if (exists) throw new BadRequestException("الكوبون موجود مسبقًا");
    return this.prisma.coupon.create({
      data: {
        code: dto.code.toUpperCase(),
        type: dto.type ?? "PERCENT",
        value: dto.value,
        maxUses: dto.maxUses,
        perUserLimit: dto.perUserLimit,
        firstRideOnly: dto.firstRideOnly ?? false,
        userId: dto.userId,
        minFare: dto.minFare,
        maxDiscount: dto.maxDiscount,
        rideClasses: dto.rideClasses ?? [],
        cityId: dto.cityId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        isActive: dto.isActive ?? true,
        fundingSource: dto.fundingSource ?? null,
        platformShare: dto.platformShare ?? null,
      },
    });
  }

  async findAll(q: PaginationDto) {
    const where: Prisma.CouponWhereInput = q.search
      ? { code: { contains: q.search.toUpperCase() } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.coupon.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException("الكوبون غير موجود");
    return coupon;
  }

  async update(id: string, dto: UpdateCouponDto): Promise<Coupon> {
    await this.findOne(id);
    return this.prisma.coupon.update({
      where: { id },
      data: {
        type: dto.type,
        value: dto.value,
        maxUses: dto.maxUses,
        perUserLimit: dto.perUserLimit,
        firstRideOnly: dto.firstRideOnly,
        userId: dto.userId,
        minFare: dto.minFare,
        maxDiscount: dto.maxDiscount,
        rideClasses: dto.rideClasses,
        cityId: dto.cityId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive,
        fundingSource: dto.fundingSource,
        platformShare: dto.platformShare,
      },
    });
  }

  /** تعطيل (لا نحذف للحفاظ على السجل) */
  async deactivate(id: string): Promise<Coupon> {
    await this.findOne(id);
    return this.prisma.coupon.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * التحقق من الكوبون وحساب الخصم على أجرة معينة.
   * يرمي خطأ إن كان غير صالح.
   */
  async validateAndCompute(
    code: string,
    userId: string,
    fare: number,
    ctx?: CouponContext,
  ): Promise<CouponResult> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!coupon) throw new NotFoundException("الكوبون غير موجود");
    if (!coupon.isActive) throw new BadRequestException("الكوبون معطّل");
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("انتهت صلاحية الكوبون");
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException("استنفد الكوبون عدد الاستخدامات");
    }
    if (coupon.userId && coupon.userId !== userId) {
      throw new BadRequestException("الكوبون غير مخصص لك");
    }
    // الحد الأدنى يُقاس على الأجرة قبل الخصم.
    // fare = 0 يعني معاينة بلا رحلة، فلا نرفض الكوبون لأجل حد أدنى لم يُقاس بعد.
    if (fare > 0 && coupon.minFare != null && fare < Number(coupon.minFare)) {
      throw new BadRequestException(
        `الكوبون يتطلب أجرة لا تقل عن ${Number(coupon.minFare)}`,
      );
    }
    // تقييد فئة الرحلة: مصفوفة فارغة تعني كل الفئات.
    if (coupon.rideClasses.length > 0) {
      if (!ctx?.rideClass || !coupon.rideClasses.includes(ctx.rideClass)) {
        throw new BadRequestException("الكوبون غير صالح لهذه الفئة");
      }
    }
    // تقييد المدينة: null يعني كل المدن.
    if (coupon.cityId && coupon.cityId !== ctx?.cityId) {
      throw new BadRequestException("الكوبون غير صالح في هذه المدينة");
    }
    // حد الاستخدام لكل مستخدم يُحسب من سجل الاسترداد الفعلي لا من عدّاد عام.
    if (coupon.perUserLimit != null) {
      const usedByUser = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (usedByUser >= coupon.perUserLimit) {
        throw new BadRequestException("استنفدت حدّك من هذا الكوبون");
      }
    }
    if (coupon.firstRideOnly) {
      const completed = await this.prisma.trip.count({
        where: { passengerId: userId, status: "COMPLETED" },
      });
      if (completed > 0) {
        throw new BadRequestException("الكوبون للرحلة الأولى فقط");
      }
    }

    const discount = this.computeDiscount(
      Number(coupon.value),
      coupon.type,
      fare,
      coupon.maxDiscount != null ? Number(coupon.maxDiscount) : null,
    );
    const finalFare = round2(fare - discount);
    // سياسة التمويل المؤثّرة: تجاوز الكوبون إن وُجد، وإلا الإعداد
    // العام من لوحة التحكم، وإلا PLATFORM كافتراضٍ آمن. تُلتقط على الرحلة وقت الطلب.
    const globalFunding = await this.settings.getValue<{
      source?: CouponFundingSource;
      platformShare?: number;
    }>(COUPON_FUNDING_SETTING_KEY, DEFAULT_COUPON_FUNDING);
    const fundingSource: CouponFundingSource =
      coupon.fundingSource ?? globalFunding?.source ?? "PLATFORM";
    const platformShare =
      coupon.platformShare != null
        ? Number(coupon.platformShare)
        : (globalFunding?.platformShare ?? 0.5);
    return { coupon, discount, finalFare, fundingSource, platformShare };
  }

  /**
   * تسجيل استخدام الكوبون: يزيد العدّاد العام ذريًا ويكتب صفًا في سجل
   * الاسترداد كي يصبح حدّ المستخدم قابلًا للفرض والتكرار قابلًا للكشف.
   * يجب استدعاؤه داخل نفس معاملة إنشاء الرحلة كي لا يُحرق الكوبون بلا رحلة.
   */
  async redeem(
    couponId: string,
    userId: string,
    tripId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const coupon = await client.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) return;

    // إعادة فحص حد المستخدم عند الحجز: التحقق السابق قد يسبق هذه اللحظة
    // بما يكفي لطلبين متوازيين من نفس الراكب.
    if (coupon.perUserLimit != null) {
      const usedByUser = await client.couponRedemption.count({
        where: { couponId, userId },
      });
      if (usedByUser >= coupon.perUserLimit) {
        throw new BadRequestException("استنفدت حدّك من هذا الكوبون");
      }
    }

    if (coupon.maxUses != null) {
      // زيادة ذرية مشروطة: لا تنجح إلا إن بقي usedCount < maxUses.
      // تمنع تجاوز الحد عند استردادين متزامنين (over-redemption).
      const claim = await client.coupon.updateMany({
        where: { id: couponId, usedCount: { lt: coupon.maxUses } },
        data: { usedCount: { increment: 1 } },
      });
      if (claim.count === 0) {
        throw new BadRequestException("استنفد الكوبون");
      }
    } else {
      // بلا حد أقصى: زيادة مباشرة.
      await client.coupon.update({
        where: { id: couponId },
        data: { usedCount: { increment: 1 } },
      });
    }

    // tripId فريد في المخطط، فإعادة المحاولة لنفس الرحلة تفشل بدل أن تُحتسب مرتين.
    await client.couponRedemption.create({
      data: { couponId, userId, tripId },
    });
  }

  /** إرجاع استخدام (عند إلغاء رحلة طُبّق عليها كوبون) */
  async release(
    couponId: string,
    tripId?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    // سجل الاسترداد هو مصدر الحقيقة: إن لم يوجد صف لهذه الرحلة فلا شيء نرجعه.
    // هذا يجعل الإرجاع idempotent فلا ينقص العدّاد مرتين عند إلغاءين متتاليين.
    if (tripId) {
      const deleted = await client.couponRedemption.deleteMany({
        where: { couponId, tripId },
      });
      if (deleted.count === 0) return;
    }
    const coupon = await client.coupon.findUnique({ where: { id: couponId } });
    if (!coupon || coupon.usedCount <= 0) return;
    await client.coupon.update({
      where: { id: couponId },
      data: { usedCount: { decrement: 1 } },
    });
  }

  private computeDiscount(
    value: number,
    type: "PERCENT" | "FIXED",
    fare: number,
    maxDiscount: number | null,
  ): number {
    const raw = type === "PERCENT" ? (fare * value) / 100 : value;
    // سقف الكوبون أولًا، ثم سقف مطلق: الخصم لا يتجاوز قيمة الرحلة.
    const capped = maxDiscount != null ? Math.min(raw, maxDiscount) : raw;
    return round2(Math.min(capped, fare));
  }
}
