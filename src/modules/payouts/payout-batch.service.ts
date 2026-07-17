import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  buildBatchTotals,
  buildBatchReference,
  canTransition,
  gatewayCapabilities,
  isValidIban,
  normalizeProviderStatus,
  PayoutBatchStatus,
} from "./payout.util";

export interface PayoutItemDraft {
  driverId: string;
  withdrawRequestId?: string;
  amountMinor: number;
  currency: string;
  iban?: string;
  bankRef?: string;
}

@Injectable()
export class PayoutBatchService {
  private readonly logger = new Logger(PayoutBatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ينشئ دفعة تسوية بنكية من عناصر محدّدة (مع التحقّق من العملة والمبالغ). */
  async createBatch(
    provider: string,
    items: PayoutItemDraft[],
    createdBy?: string,
  ) {
    const caps = gatewayCapabilities(provider);
    if (!caps.payout) {
      throw new BadRequestException("PROVIDER_NO_PAYOUT");
    }
    const totals = buildBatchTotals(items);
    for (const it of items) {
      if (it.iban && !isValidIban(it.iban)) {
        throw new BadRequestException("INVALID_IBAN");
      }
    }
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const seq = await this.prisma.payoutBatch.count();
    const reference = buildBatchReference(provider, yyyymmdd, seq + 1);

    return this.prisma.payoutBatch.create({
      data: {
        reference,
        provider,
        status: "DRAFT",
        currency: totals.currency,
        totalMinor: totals.totalMinor,
        itemCount: totals.count,
        createdBy: createdBy ?? null,
        items: {
          create: items.map((it) => ({
            driverId: it.driverId,
            withdrawRequestId: it.withdrawRequestId ?? null,
            amountMinor: it.amountMinor,
            currency: it.currency,
            iban: it.iban ?? null,
            bankRef: it.bankRef ?? null,
            status: "PENDING",
          })),
        },
      },
      include: { items: true },
    });
  }

  async transition(
    batchId: string,
    to: PayoutBatchStatus,
    failureReason?: string,
  ) {
    const batch = await this.prisma.payoutBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    if (!canTransition(batch.status as PayoutBatchStatus, to)) {
      throw new BadRequestException(
        `ILLEGAL_TRANSITION_${batch.status}_TO_${to}`,
      );
    }
    const now = new Date();
    return this.prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: to,
        submittedAt: to === "SUBMITTED" ? now : batch.submittedAt,
        paidAt: to === "PAID" ? now : batch.paidAt,
        failedAt: to === "FAILED" ? now : batch.failedAt,
        failureReason: failureReason ?? batch.failureReason,
        ...(to === "PAID"
          ? { items: { updateMany: { where: {}, data: { status: "PAID" } } } }
          : {}),
      },
      include: { items: true },
    });
  }

  /** تحديث حالة الدفعة من حالة مزوّد خام (يُستدعى من webhook المزوّد). */
  async applyProviderStatus(batchId: string, rawStatus: string) {
    const internal = normalizeProviderStatus(rawStatus);
    const batch = await this.prisma.payoutBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    if (!canTransition(batch.status as PayoutBatchStatus, internal)) {
      this.logger.warn(
        `Ignoring provider status ${rawStatus} for batch ${batchId} in ${batch.status}`,
      );
      return batch;
    }
    return this.transition(batchId, internal, `provider:${rawStatus}`);
  }

  async get(batchId: string) {
    return this.prisma.payoutBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { items: true },
    });
  }

  async list(status?: string) {
    return this.prisma.payoutBatch.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
