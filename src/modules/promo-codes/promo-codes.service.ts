import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PromoCode } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { DEFAULT_CURRENCY, round2 } from "../../common/money.util";
import { FinancialService } from "../financial/financial.service";
import {
  CreatePromoCodeDto,
  UpdatePromoCodeDto,
} from "./dto/promo-codes.dto";
import {
  evaluatePromoRedeemability,
  normalizePromoCode,
  resolvePromoCurrency,
} from "./promo-code.util";

export interface PromoRedeemResult {
  redeemed: true;
  code: string;
  amount: number;
  currency: string;
}

/**
 * إدارة رموز الترويج (Promo Codes) واستبدالها كرصيد محفظة.
 *
 * متمايز عن CouponsService (خصم أجرة عند الدفع): هنا المستخدم
 * يستبدل رمزًا فيُضاف رصيد ثابت إلى محفظته عبر الدفتر المالي (إدخال مزدوج).
 */
@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async create(dto: CreatePromoCodeDto): Promise<PromoCode> {
    const code = normalizePromoCode(dto.code);
    const exists = await this.prisma.promoCode.findUnique({ where: { code } });
    if (exists) {
      throw new AppException("CONFLICT", {
        message: "الرمز الترويجي موجود مسبقًا",
      });
    }
    return this.prisma.promoCode.create({
      data: {
        code,
        description: dto.description ?? null,
        discountType: dto.discountType ?? "FIXED",
        value: dto.value,
        currency: dto.currency ? dto.currency.toUpperCase() : null,
        maxRedemptions: dto.maxRedemptions ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll(q: PaginationDto) {
    const where: Prisma.PromoCodeWhereInput = q.search
      ? { code: { contains: q.search.toUpperCase() } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.promoCode.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.promoCode.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string): Promise<PromoCode> {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) throw new AppException("PROMO_CODE_NOT_FOUND");
    return promo;
  }

  async update(id: string, dto: UpdatePromoCodeDto): Promise<PromoCode> {
    await this.findOne(id);
    return this.prisma.promoCode.update({
      where: { id },
      data: {
        description: dto.description,
        discountType: dto.discountType,
        value: dto.value,
        currency:
          dto.currency === undefined
            ? undefined
            : dto.currency
              ? dto.currency.toUpperCase()
              : null,
        maxRedemptions: dto.maxRedemptions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  /** تعطيل (لا نحذف للحفاظ على السجل). */
  async deactivate(id: string): Promise<PromoCode> {
    await this.findOne(id);
    return this.prisma.promoCode.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * استبدال رمز ترويجي: يتحقّق، يسجّل الاستبدال (مرة واحدة لكل مستخدم)،
   * ثم يضيف الرصيد إلى محفظة المستخدم — كلّه ضمن معاملة واحدة ذرية.
   */
  async redeem(userId: string, rawCode: string): Promise<PromoRedeemResult> {
    const code = normalizePromoCode(rawCode);
    return this.prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.findUnique({ where: { code } });
      if (!promo) throw new AppException("PROMO_CODE_NOT_FOUND");

      const verdict = evaluatePromoRedeemability({
        isActive: promo.isActive,
        discountType: promo.discountType,
        expiresAt: promo.expiresAt,
        redeemedCount: promo.redeemedCount,
        maxRedemptions: promo.maxRedemptions,
      });
      if (!verdict.ok) {
        if (verdict.reason === "exhausted") {
          throw new AppException("PROMO_CODE_EXHAUSTED");
        }
        throw new AppException("PROMO_CODE_INVALID", {
          details: { reason: verdict.reason },
        });
      }

      const currency = resolvePromoCurrency(promo.currency, DEFAULT_CURRENCY);
      const amount = round2(Number(promo.value));

      // (1) حارس المستخدم: إنشاء سجل الاستبدال أولاً؛ فشل التفرد (P2002)
      // يعني أن المستخدم استبدل الرمز مسبقًا.
      try {
        await tx.promoCodeRedemption.create({
          data: { promoCodeId: promo.id, userId, amount, currency },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new AppException("PROMO_CODE_ALREADY_REDEEMED");
        }
        throw e;
      }

      // (2) حارس الحد العالمي: مطالبة ذرية مشروطة تمنع تجاوز maxRedemptions.
      if (promo.maxRedemptions != null) {
        const claim = await tx.promoCode.updateMany({
          where: { id: promo.id, redeemedCount: { lt: promo.maxRedemptions } },
          data: { redeemedCount: { increment: 1 } },
        });
        if (claim.count === 0) throw new AppException("PROMO_CODE_EXHAUSTED");
      } else {
        await tx.promoCode.update({
          where: { id: promo.id },
          data: { redeemedCount: { increment: 1 } },
        });
      }

      // (3) إضافة الرصيد إلى المحفظة عبر الدفتر (idempotent عبر مفتاح فريد).
      await this.financial.grantPromotionalCredit(tx, {
        userId,
        amount,
        currency,
        referenceType: "PROMO_CODE",
        referenceId: promo.id,
        reason: `Promo code ${promo.code}`,
        idempotencyKey: `promo:redeem:${promo.id}:${userId}`,
      });

      return { redeemed: true as const, code: promo.code, amount, currency };
    });
  }
}
