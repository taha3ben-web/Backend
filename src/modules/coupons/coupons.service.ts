import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Coupon, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateCouponDto, UpdateCouponDto } from "./dto/coupons.dto";
import { round2 } from "../../common/money.util";

export interface CouponResult {
  coupon: Coupon;
  discount: number;
  finalFare: number;
}

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

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
        firstRideOnly: dto.firstRideOnly ?? false,
        userId: dto.userId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        isActive: dto.isActive ?? true,
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
        firstRideOnly: dto.firstRideOnly,
        userId: dto.userId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive,
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
    );
    const finalFare = round2(fare - discount);
    return { coupon, discount, finalFare };
  }

  /** زيادة عدّاد الاستخدام ذريًا (مع حماية maxUses) */
  async redeem(couponId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const coupon = await client.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) return;

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
      return;
    }

    // بلا حد أقصى: زيادة مباشرة.
    await client.coupon.update({
      where: { id: couponId },
      data: { usedCount: { increment: 1 } },
    });
  }

  /** إرجاع استخدام (عند إلغاء رحلة طُبّق عليها كوبون) */
  async release(
    couponId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
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
  ): number {
    const raw = type === "PERCENT" ? (fare * value) / 100 : value;
    // الخصم لا يتجاوز قيمة الرحلة
    return round2(Math.min(raw, fare));
  }
}
