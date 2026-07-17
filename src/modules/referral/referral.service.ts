import { Injectable, Logger } from "@nestjs/common";
import { Prisma, Referral, ReferralCode } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { round2 } from "../../common/money.util";
import { FinancialService } from "../financial/financial.service";
import {
  generateReferralCode,
  isSelfReferral,
  normalizeReferralCode,
  parseReferralConfig,
} from "./referral.util";

export interface ReferralRewardResult {
  rewarded: boolean;
  status: "REWARDED" | "PENDING" | "NONE";
  referrerReward?: number;
  refereeReward?: number;
  currency?: string;
}

/**
 * نظام الإحالة (Referral): توليد رمز لكل مستخدم، ربط مُحال بمُحيل،
 * ومنح مكافآت للطرفين عند التأهّل — عبر grantPromotionalCredit القائم (إعادة استخدام، بلا تكرار).
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  /** يعيد رمز إحالة المستخدم (يولّده عند أول طلب مع معالجة تصادم الرمز). */
  async getOrCreateMyCode(userId: string): Promise<ReferralCode> {
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    });
    if (existing) return existing;

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.prisma.referralCode.create({
          data: { userId, code: generateReferralCode() },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          const target = (e.meta?.target as string[] | string | undefined) ?? "";
          // تصادم userId => أُنشئ بالتوازي؛ أعد الجلب.
          if (String(target).includes("userId")) {
            const race = await this.prisma.referralCode.findUnique({
              where: { userId },
            });
            if (race) return race;
          }
          // تصادم code => أعد التوليد.
          continue;
        }
        throw e;
      }
    }
    throw new AppException("INTERNAL", {
      message: "تعذّر توليد رمز إحالة فريد",
    });
  }

  /** المُحال الجديد يُدخل رمز مُحيل لربط حسابه (مرة واحدة فقط). */
  async applyReferral(refereeId: string, rawCode: string): Promise<Referral> {
    const cfg = parseReferralConfig(process.env);
    if (!cfg.enabled) throw new AppException("REFERRAL_DISABLED");

    const code = normalizeReferralCode(rawCode);
    const owner = await this.prisma.referralCode.findUnique({ where: { code } });
    if (!owner) throw new AppException("REFERRAL_CODE_NOT_FOUND");
    if (isSelfReferral(owner.userId, refereeId)) {
      throw new AppException("REFERRAL_SELF");
    }

    try {
      return await this.prisma.referral.create({
        data: {
          referrerId: owner.userId,
          refereeId,
          code,
          status: "PENDING",
          currency: cfg.currency,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // قيد فريد على refereeId => الحساب مُحال مسبقًا.
        throw new AppException("REFERRAL_ALREADY_APPLIED");
      }
      throw e;
    }
  }

  /**
   * يُأهّل إحالة المُحال ويمنح المكافآت للطرفين (idempotent).
   * نقطة التكامل: يُستدعى عند تأهّل المُحال (مثلاً أول رحلة مكتملة) أو يدويًا من اللوحة.
   * لا يرمي خطأ إن لم توجد إحالة (ليس كل مستخدم مُحالًا).
   */
  async qualifyReferral(refereeId: string): Promise<ReferralRewardResult> {
    return this.prisma.$transaction(async (tx) => {
      const ref = await tx.referral.findUnique({ where: { refereeId } });
      if (!ref) return { rewarded: false, status: "NONE" };
      if (ref.status === "REWARDED") {
        return {
          rewarded: false,
          status: "REWARDED",
          referrerReward: ref.referrerReward
            ? Number(ref.referrerReward)
            : undefined,
          refereeReward: ref.refereeReward
            ? Number(ref.refereeReward)
            : undefined,
          currency: ref.currency ?? undefined,
        };
      }

      const cfg = parseReferralConfig(process.env);
      const currency = ref.currency ?? cfg.currency;
      const referrerReward = round2(cfg.referrerReward);
      const refereeReward = round2(cfg.refereeReward);

      if (referrerReward > 0) {
        await this.financial.grantPromotionalCredit(tx, {
          userId: ref.referrerId,
          amount: referrerReward,
          currency,
          referenceType: "REFERRAL",
          referenceId: ref.id,
          reason: `Referral reward (referrer) ${ref.id}`,
          idempotencyKey: `referral:reward:referrer:${ref.id}`,
        });
      }
      if (refereeReward > 0) {
        await this.financial.grantPromotionalCredit(tx, {
          userId: ref.refereeId,
          amount: refereeReward,
          currency,
          referenceType: "REFERRAL",
          referenceId: ref.id,
          reason: `Referral reward (referee) ${ref.id}`,
          idempotencyKey: `referral:reward:referee:${ref.id}`,
        });
      }

      const now = new Date();
      await tx.referral.update({
        where: { id: ref.id },
        data: {
          status: "REWARDED",
          qualifiedAt: ref.qualifiedAt ?? now,
          rewardedAt: now,
          referrerReward,
          refereeReward,
          currency,
        },
      });

      return {
        rewarded: true,
        status: "REWARDED",
        referrerReward,
        refereeReward,
        currency,
      };
    });
  }

  /** إحالات المستخدم الحالي (كمُحيل). */
  async myReferrals(userId: string, q: PaginationDto) {
    const where: Prisma.ReferralWhereInput = { referrerId: userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.referral.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** قائمة إدارية بكل الإحالات. */
  async findAll(q: PaginationDto) {
    const where: Prisma.ReferralWhereInput = q.search
      ? { code: { contains: q.search.toUpperCase() } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.referral.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
}
