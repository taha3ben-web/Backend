import { Injectable, Logger } from "@nestjs/common";
import { Prisma, WalletTopUpStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { DEFAULT_CURRENCY, round2, toMinorUnits } from "../../common/money.util";
import { FinancialService } from "../financial/financial.service";
import { SettingsService } from "../settings/settings.service";
import {
  NormalizedWebhookEvent,
  PaymentProviderService,
} from "./payment-provider.service";
import { CreateWalletTopUpDto } from "./dto/wallet-topup.dto";

/** حدود مبلغ الشحن — مضبوطة من لوحة التحكم. */
export const WALLET_TOPUP_SETTING_KEY = "wallet.topup";

interface WalletTopUpPolicy {
  minAmount?: number;
  maxAmount?: number;
}

/** الحالات النهائية التي لا يجوز الانتقال منها. */
const TERMINAL: WalletTopUpStatus[] = ["CAPTURED", "FAILED", "CANCELED"];

/**
 * شحن المحفظة — المسار الوحيد الذي يُدخل رصيدًا ذاتيًا إلى:
 *   • flaminGO Pay للراكب (رصيد دفع مخزَّن، غير قابل للسحب)
 *   • محفظة عمولة السائق (رصيد تشغيلي مسبق الدفع لتغطية العمولة)
 *
 * ===== ما لا تفعله هذه الخدمة =====
 * لا تنشئ دفترًا ماليًا ثانيًا ولا تكتب أرصدة مباشرة: الإيداع كله يمرّ عبر
 * `FinancialService.creditWalletTopUp` → `LedgerCoreService.post` بقيد مزدوج
 * متوازن. ولا تُعيد تنفيذ تكامل أي مزوّد: تستعمل سجل المحوّلات القائم
 * (`PaymentProviderService`)، فإضافة Visa مستقبلًا = محوّل جديد + تسجيله،
 * بلا لمس منطق المحفظة.
 *
 * ===== ثلاث طبقات خمول (idempotency) =====
 *   1. `WalletTopUp.idempotencyKey` — الطلب نفسه لا يُنشئ عمليتين.
 *   2. `WalletTopUpEvent.idempotencyKey` — الـwebhook المُعاد إرساله يُرفض
 *      قبل أي إيداع.
 *   3. `LedgerTransaction.idempotencyKey = wallet:topup:<id>` — الحارس
 *      الأخير في قاعدة البيانات: حتى لو أخفقت الطبقتان، الإيداع يحدث مرة.
 */
@Injectable()
export class WalletTopUpsService {
  private readonly logger = new Logger(WalletTopUpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
    private readonly provider: PaymentProviderService,
    private readonly settings: SettingsService,
  ) {}

  /** إنشاء عملية شحن + جلسة الدفع من المزوّد. */
  async create(userId: string, dto: CreateWalletTopUpDto) {
    const currency = (dto.currency ?? DEFAULT_CURRENCY).toUpperCase();
    const amount = round2(dto.amount);
    await this.assertAmountAllowed(amount);

    const method = dto.method ?? "CARD";
    const idempotencyKey =
      dto.idempotencyKey?.trim() ||
      `wallet-topup:${userId}:${currency}:${toMinorUnits(amount)}:${new Date()
        .toISOString()
        .slice(0, 16)}`;

    const existing = await this.prisma.walletTopUp.findUnique({
      where: { idempotencyKey },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    if (existing) {
      // الطلب نفسه مرّتين ⇒ نفس العملية، بلا جلسة دفع جديدة ولا رسم مزدوج.
      if (existing.userId !== userId) {
        throw new AppException("FORBIDDEN", {
          details: { reason: "idempotency_key_owned_by_another_user" },
        });
      }
      return { topUp: existing, checkout: null, reused: true as const };
    }

    const created = await this.prisma.walletTopUp.create({
      data: {
        userId,
        amount: new Prisma.Decimal(amount),
        currency,
        method,
        provider: this.provider.resolveProvider(method, dto.provider),
        status: "PENDING",
        reference: dto.reference ?? null,
        idempotencyKey,
      },
    });

    // جلسة الدفع تُطلب **بعد** تثبيت الصف كي يحمل المزوّد معرّفنا الحقيقي،
    // فيمكن مطابقة الـwebhook لاحقًا بلا تخمين.
    const checkout = await this.provider.createCheckout({
      paymentId: created.id,
      // لا رحلة هنا: الشحن عملية مستقلة. نمرّر معرّف الشحن كي يبقى العقد
      // مع المحوّلات واحدًا بلا نوع مدخل ثانٍ.
      tripId: `wallet-topup:${created.id}`,
      method,
      amount,
      currency,
      provider: dto.provider,
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    });

    const topUp = await this.prisma.walletTopUp.update({
      where: { id: created.id },
      data: {
        provider: checkout.provider,
        providerPaymentId: checkout.providerPaymentId,
        providerStatus: checkout.providerStatus,
        metadata: this.toJson(checkout.payload),
        events: {
          create: {
            type: "checkout_initialized",
            status: "PENDING",
            provider: checkout.provider,
            idempotencyKey: `wallet-topup:checkout:${created.id}`,
            payload: this.toJson(checkout.payload),
          },
        },
      },
    });

    return { topUp, checkout, reused: false as const };
  }

  /** عمليات الشحن الخاصة بالمستخدم الحالي. */
  async listForUser(userId: string, q: PaginationDto) {
    const where: Prisma.WalletTopUpWhereInput = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.walletTopUp.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.walletTopUp.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** قائمة اللوحة (تسوية ومراجعة). */
  async adminList(
    q: PaginationDto,
    filters: { status?: WalletTopUpStatus; userId?: string; provider?: string },
  ) {
    const where: Prisma.WalletTopUpWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.provider
        ? { provider: { equals: filters.provider, mode: "insensitive" } }
        : {}),
    };
    const [items, total, totals] = await this.prisma.$transaction([
      this.prisma.walletTopUp.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          user: { select: { id: true, name: true, phone: true, type: true } },
          events: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      }),
      this.prisma.walletTopUp.count({ where }),
      this.prisma.walletTopUp.aggregate({
        where: { ...where, status: "CAPTURED" },
        _sum: { amount: true },
      }),
    ]);
    return {
      items,
      total,
      capturedAmount: Number(totals._sum.amount ?? 0),
      page: q.page,
      limit: q.limit,
    };
  }

  /**
   * webhook المزوّد. يُرجع `matched: false` إن لم يكن الحدث لعملية شحن،
   * فيُكمل المستدعي إلى مسار دفعات الرحلات دون تخمين.
   */
  async processWebhook(
    providerName: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): Promise<
    | { matched: false }
    | {
        matched: true;
        accepted: true;
        duplicate?: true;
        topUpId: string;
        credited: boolean;
      }
  > {
    const normalized = this.provider.normalizeWebhook(
      providerName,
      payload,
      eventId,
    );
    const topUp = await this.findTopUp(normalized);
    if (!topUp) return { matched: false };

    // الطبقة الثانية من الخمول: نفس الحدث مرّتين لا يودع مرّتين.
    const duplicate = await this.prisma.walletTopUpEvent.findUnique({
      where: { idempotencyKey: normalized.idempotencyKey },
      select: { id: true },
    });
    if (duplicate) {
      return {
        matched: true,
        accepted: true,
        duplicate: true,
        topUpId: topUp.id,
        credited: topUp.status === "CAPTURED",
      };
    }

    const target = this.mapStatus(normalized.status);
    await this.prisma.walletTopUpEvent.create({
      data: {
        topUpId: topUp.id,
        type: `webhook:${normalized.eventType}`,
        status: normalized.status ?? null,
        provider: normalized.provider,
        idempotencyKey: normalized.idempotencyKey,
        reference: normalized.reference ?? null,
        payload: this.toJson(normalized.payload),
      },
    });

    if (!target || TERMINAL.includes(topUp.status)) {
      // حدث معلوماتي، أو عملية وصلت حالتها النهائية سابقًا.
      await this.prisma.walletTopUp.update({
        where: { id: topUp.id },
        data: {
          providerStatus: normalized.providerStatus ?? topUp.providerStatus,
          statusReason: normalized.reason ?? topUp.statusReason,
        },
      });
      return {
        matched: true,
        accepted: true,
        topUpId: topUp.id,
        credited: topUp.status === "CAPTURED",
      };
    }

    if (target === "CAPTURED") {
      await this.capture(topUp.id);
      return { matched: true, accepted: true, topUpId: topUp.id, credited: true };
    }

    await this.prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: target,
        providerStatus: normalized.providerStatus ?? topUp.providerStatus,
        statusReason: normalized.reason ?? null,
        ...(target === "FAILED" ? { failedAt: new Date() } : {}),
        ...(target === "CANCELED" ? { canceledAt: new Date() } : {}),
      },
    });
    return {
      matched: true,
      accepted: true,
      topUpId: topUp.id,
      credited: false,
    };
  }

  /**
   * تأكيد الشحن وإيداع الرصيد.
   *
   * الإيداع أولًا ثم تحديث الحالة: القيد خامل التكرار عبر
   * `wallet:topup:<id>` في `LedgerTransaction`، فإعادة المحاولة بعد فشل
   * تحديث الحالة لا تُنتج مالًا جديدًا. العكس (تحديث الحالة أولًا) كان
   * سيُخفي إخفاق الإيداع ويُظهر رصيدًا غير موجود.
   */
  async capture(topUpId: string, actorId?: string) {
    const topUp = await this.prisma.walletTopUp.findUnique({
      where: { id: topUpId },
    });
    if (!topUp) {
      throw new AppException("WALLET_TOPUP_NOT_FOUND", {
        details: { topUpId },
      });
    }
    if (topUp.status === "CAPTURED") return topUp; // idempotent
    if (TERMINAL.includes(topUp.status)) {
      throw new AppException("WALLET_TOPUP_INVALID_STATE", {
        details: { topUpId, status: topUp.status },
      });
    }

    await this.financial.creditWalletTopUp({
      topUpId: topUp.id,
      userId: topUp.userId,
      amount: Number(topUp.amount),
      currency: topUp.currency,
      provider: topUp.provider,
      reference: topUp.reference,
    });

    const captured = await this.prisma.walletTopUp.update({
      where: { id: topUp.id },
      data: {
        status: "CAPTURED",
        capturedAt: new Date(),
        statusReason: null,
        events: {
          create: {
            type: "captured",
            status: "CAPTURED",
            provider: topUp.provider,
            idempotencyKey: `wallet-topup:captured:${topUp.id}`,
            payload: this.toJson({ actorId: actorId ?? "SYSTEM" }),
          },
        },
      },
    });
    this.logger.log(
      `شحن محفظة ${topUp.id} للمستخدم ${topUp.userId}: ${Number(topUp.amount)} ${topUp.currency}`,
    );
    return captured;
  }

  private async findTopUp(event: NormalizedWebhookEvent) {
    if (event.internalPaymentId) {
      const byId = await this.prisma.walletTopUp.findUnique({
        where: { id: event.internalPaymentId },
      });
      if (byId) return byId;
    }
    if (event.providerPaymentId) {
      const byProvider = await this.prisma.walletTopUp.findFirst({
        where: {
          provider: event.provider,
          providerPaymentId: event.providerPaymentId,
        },
      });
      if (byProvider) return byProvider;
    }
    return null;
  }

  private mapStatus(
    status?: string | null,
  ): WalletTopUpStatus | null {
    switch (status) {
      case "CAPTURED":
      case "PAID":
        return "CAPTURED";
      case "FAILED":
        return "FAILED";
      case "CANCELED":
        return "CANCELED";
      default:
        return null;
    }
  }

  /** حدود المبلغ من إعدادات اللوحة (بلا أي رقم مبرمَج غير «أكبر من صفر»). */
  private async assertAmountAllowed(amount: number): Promise<void> {
    if (!Number.isFinite(amount) || toMinorUnits(amount) <= 0) {
      throw new AppException("WALLET_TOPUP_AMOUNT_INVALID", {
        details: { amount },
      });
    }
    const policy = await this.settings
      .getValue<WalletTopUpPolicy>(WALLET_TOPUP_SETTING_KEY)
      .catch(() => null);
    const min = Number(policy?.minAmount);
    const max = Number(policy?.maxAmount);
    if (Number.isFinite(min) && min > 0 && amount < min) {
      throw new AppException("WALLET_TOPUP_AMOUNT_INVALID", {
        details: { amount, minAmount: min },
      });
    }
    if (Number.isFinite(max) && max > 0 && amount > max) {
      throw new AppException("WALLET_TOPUP_AMOUNT_INVALID", {
        details: { amount, maxAmount: max },
      });
    }
  }

  private toJson(
    value?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
