import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { WithdrawalsService } from "../payments/withdrawals.service";
import { PayoutBatchService, PayoutItemDraft } from "./payout-batch.service";
import { gatewayCapabilities, isValidIban } from "./payout.util";
import { TransactionalEmailService } from "../notifications/transactional-email.service";
import { formatEmailAmount } from "../notifications/transactional-email.util";
import { DEFAULT_CURRENCY, toMinorUnits } from "../../common/money.util";

export interface PayoutSettlementResult {
  batchId: string;
  reference: string;
  settled: string[];
  failed: Array<{ withdrawRequestId: string; reason: string }>;
}

/**
 * الجسر بين طلبات سحب السائقين ودفعات الصرف البنكية.
 *
 * قبل هذه الوحدة كان `PayoutBatchService` معزولًا تمامًا: يُنشئ دفعات ويحرّك
 * حالاتها دون أن يلمس طلبات السحب أو دفتر القيود، فيبقى المال محجوزًا في
 * `LOCKED` إلى الأبد ما لم يضغط موظف زر «مدفوع» يدويًا لكل طلب على حدة.
 */
@Injectable()
export class PayoutBridgeService {
  private readonly logger = new Logger(PayoutBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: PayoutBatchService,
    private readonly withdrawals: WithdrawalsService,
    @Optional() private readonly mailer?: TransactionalEmailService,
  ) {}

  /** طلبات السحب المعتمدة وغير المدرجة في أي دفعة نشطة (قائمة الانتظار). */
  async queue(limit = 100) {
    const cap = Math.min(500, Math.max(1, limit));
    const linked = await this.prisma.payoutItem.findMany({
      where: {
        withdrawRequestId: { not: null },
        batch: { status: { in: ["DRAFT", "SUBMITTED", "PROCESSING", "PAID"] } },
      },
      select: { withdrawRequestId: true },
    });
    const excluded = linked
      .map((i) => i.withdrawRequestId)
      .filter((id): id is string => Boolean(id));

    const items = await this.prisma.withdrawRequest.findMany({
      where: {
        status: "APPROVED",
        ...(excluded.length ? { id: { notIn: excluded } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: cap,
      include: {
        user: { select: { name: true, phone: true } },
        driver: {
          select: {
            id: true,
            payoutIban: true,
            payoutBankName: true,
            payoutAccountHolder: true,
          },
        },
      },
    });

    return {
      total: items.length,
      items: items.map((w) => ({
        withdrawRequestId: w.id,
        driverId: w.driverId,
        driverName: w.user?.name ?? null,
        amount: Number(w.amount),
        iban: w.driver?.payoutIban ?? null,
        bankName: w.driver?.payoutBankName ?? null,
        accountHolder: w.driver?.payoutAccountHolder ?? null,
        ready: Boolean(w.driver?.payoutIban),
        createdAt: w.createdAt,
      })),
    };
  }

  /** ينشئ دفعة صرف من طلبات سحب معتمدة (لا يحرّك مالًا بعد). */
  async draftFromWithdrawals(
    provider: string,
    withdrawRequestIds: string[],
    createdBy?: string,
  ) {
    const ids = Array.from(new Set(withdrawRequestIds ?? []));
    if (!ids.length) throw new BadRequestException("NO_WITHDRAWAL_IDS");

    const caps = gatewayCapabilities(provider);
    if (!caps.payout) throw new BadRequestException("PROVIDER_NO_PAYOUT");

    const requests = await this.prisma.withdrawRequest.findMany({
      where: { id: { in: ids } },
      include: {
        driver: {
          select: { id: true, payoutIban: true, payoutAccountHolder: true },
        },
      },
    });
    if (requests.length !== ids.length) {
      throw new BadRequestException("WITHDRAWAL_NOT_FOUND");
    }

    const alreadyLinked = await this.prisma.payoutItem.count({
      where: {
        withdrawRequestId: { in: ids },
        batch: { status: { in: ["DRAFT", "SUBMITTED", "PROCESSING", "PAID"] } },
      },
    });
    if (alreadyLinked > 0) {
      throw new BadRequestException("WITHDRAWAL_ALREADY_IN_BATCH");
    }

    const drafts: PayoutItemDraft[] = [];
    for (const w of requests) {
      if (w.status !== "APPROVED") {
        throw new BadRequestException(`WITHDRAWAL_NOT_APPROVED_${w.id}`);
      }
      const amountMinor = toMinorUnits(Number(w.amount));
      if (amountMinor <= 0) {
        throw new BadRequestException(`WITHDRAWAL_INVALID_AMOUNT_${w.id}`);
      }
      const iban = w.driver?.payoutIban ?? undefined;
      if (provider.toLowerCase() !== "manual") {
        if (!iban) throw new BadRequestException(`DRIVER_IBAN_MISSING_${w.id}`);
        if (!isValidIban(iban)) {
          throw new BadRequestException(`DRIVER_IBAN_INVALID_${w.id}`);
        }
      }
      drafts.push({
        driverId: w.driverId,
        withdrawRequestId: w.id,
        amountMinor,
        currency: DEFAULT_CURRENCY,
        iban,
      });
    }

    const batch = await this.batches.createBatch(provider, drafts, createdBy);
    this.logger.log(`دفعة صرف ${batch.reference} بـ ${drafts.length} طلب سحب`);
    return batch;
  }

  /**
   * إتمام الدفعة: يحوّل كل طلب سحب مرتبط إلى PAID (وهو ما يُفرِج عن المبلغ
   * المحجوز في دفتر القيود عبر `completeWithdrawal`)، ثم ينقل الدفعة إلى PAID.
   *
   * السحوبات تُسوّى أولًا لأنها الحقيقة المالية؛ حالة الدفعة مجرّد غلاف
   * تشغيلي. الفشل الجزئي يُسجَّل على العنصر نفسه ويبقى قابلًا لإعادة المحاولة
   * لأنّ `markPaid` يرفض الانتقال المكرر.
   */
  async settleBatch(
    batchId: string,
    actorId: string,
  ): Promise<PayoutSettlementResult> {
    const batch = await this.batches.get(batchId);
    if (batch.status === "PAID") {
      throw new BadRequestException("BATCH_ALREADY_PAID");
    }
    if (batch.status === "CANCELED" || batch.status === "FAILED") {
      throw new BadRequestException(`BATCH_TERMINAL_${batch.status}`);
    }

    const settled: string[] = [];
    const failed: Array<{ withdrawRequestId: string; reason: string }> = [];

    for (const item of batch.items) {
      if (!item.withdrawRequestId) continue;
      try {
        await this.withdrawals.markPaid(
          item.withdrawRequestId,
          actorId,
          `payout:${batch.reference}`,
        );
        settled.push(item.withdrawRequestId);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error ?? "UNKNOWN");
        failed.push({ withdrawRequestId: item.withdrawRequestId, reason });
        this.logger.warn(
          `تعذر صرف الطلب ${item.withdrawRequestId} في الدفعة ${batch.reference}: ${reason}`,
        );
      }
    }

    if (batch.status === "DRAFT") {
      await this.batches.transition(batchId, "SUBMITTED");
    }
    await this.batches.transition(
      batchId,
      "PAID",
      failed.length ? `partial:${failed.length}_failed` : undefined,
    );

    for (const f of failed) {
      await this.prisma.payoutItem.updateMany({
        where: { batchId, withdrawRequestId: f.withdrawRequestId },
        data: { status: "FAILED", failureReason: f.reason.slice(0, 500) },
      });
    }

    await this.emailSettled(settled, batch.reference);

    return { batchId, reference: batch.reference, settled, failed };
  }

  /**
   * بريد تأكيد الصرف لكل سائق تمّ دفع طلبه — أفضل جهد.
   *
   * المال خرج فعلًا قبل هذا السطر؛ فشل البريد لا يجوز أن يُرجِع دفعة ناجحة.
   */
  private async emailSettled(
    withdrawRequestIds: string[],
    reference: string,
  ): Promise<void> {
    if (!this.mailer || withdrawRequestIds.length === 0) return;
    const requests = await this.prisma.withdrawRequest
      .findMany({
        where: { id: { in: withdrawRequestIds } },
        select: { userId: true, amount: true },
      })
      .catch(() => []);
    for (const request of requests) {
      this.mailer.fireAndForget({
        userId: request.userId,
        template: "payout_settled",
        vars: {
          amount: formatEmailAmount(request.amount),
          currency: DEFAULT_CURRENCY,
          reference,
        },
      });
    }
  }

  /** يحدّث بيانات التحويل البنكي لسائق (لوحة التحكم أو السائق نفسه). */
  async setBankDetails(
    driverId: string,
    input: { iban?: string; bankName?: string; accountHolder?: string },
  ) {
    if (input.iban && !isValidIban(input.iban)) {
      throw new BadRequestException("INVALID_IBAN");
    }
    return this.prisma.driver.update({
      where: { id: driverId },
      data: {
        payoutIban: input.iban ?? undefined,
        payoutBankName: input.bankName ?? undefined,
        payoutAccountHolder: input.accountHolder ?? undefined,
      },
      select: {
        id: true,
        payoutIban: true,
        payoutBankName: true,
        payoutAccountHolder: true,
      },
    });
  }

  /** يعيد بيانات البنك الخاصة بسائق من معرّف المستخدم. */
  async bankDetailsForUser(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: {
        id: true,
        payoutIban: true,
        payoutBankName: true,
        payoutAccountHolder: true,
      },
    });
    if (!driver) throw new BadRequestException("DRIVER_NOT_FOUND");
    return driver;
  }
}
