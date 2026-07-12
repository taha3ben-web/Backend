import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { FinancialAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { FinancialCommand, PostingLine } from "./financial.types";

const PLATFORM_PARTY_ID = "00000000-0000-0000-0000-000000000001";
const MONEY_SCALE = 100;
const toMinor = (value: number): number => Math.round(value * MONEY_SCALE);

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);
  constructor(private readonly prisma: PrismaService) {}

  private assertCurrency(currency: string): void { if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Invalid ISO currency"); }
  private assertBalanced(lines: PostingLine[]): void {
    if (lines.length < 2) throw new BadRequestException("Ledger transaction needs at least two entries");
    const debit = lines.filter((line) => line.direction === "DEBIT").reduce((sum, line) => sum + toMinor(line.amount), 0);
    const credit = lines.filter((line) => line.direction === "CREDIT").reduce((sum, line) => sum + toMinor(line.amount), 0);
    if (debit <= 0 || debit !== credit) throw new BadRequestException("Unbalanced ledger transaction");
  }

  private async userAccount(tx: Prisma.TransactionClient, userId: string, currency: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundException("Financial party user not found");
    const party = await tx.financialParty.upsert({ where: { userId }, create: { type: "USER", userId, displayName: user.name }, update: { displayName: user.name } });
    const code = `USER:${userId}:${currency}:AVAILABLE`;
    return tx.financialAccount.upsert({ where: { code }, create: { partyId: party.id, code, type: "LIABILITY", currency }, update: { isActive: true } });
  }

  private async platformAccount(tx: Prisma.TransactionClient, codeSuffix: string, type: FinancialAccountType, currency: string) {
    const party = await tx.financialParty.upsert({ where: { id: PLATFORM_PARTY_ID }, create: { id: PLATFORM_PARTY_ID, type: "PLATFORM", displayName: "NOVA Ride" }, update: {} });
    const code = `PLATFORM:${codeSuffix}:${currency}`;
    return tx.financialAccount.upsert({ where: { code }, create: { partyId: party.id, code, type, currency }, update: { isActive: true } });
  }

  private async post(tx: Prisma.TransactionClient, input: FinancialCommand) {
    this.assertCurrency(input.currency); this.assertBalanced(input.lines);
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { entries: true } });
    if (existing) return existing;
    const row = await tx.ledgerTransaction.create({ data: { command: input.command, idempotencyKey: input.idempotencyKey, currency: input.currency, referenceType: input.referenceType, referenceId: input.referenceId, reversalOfId: input.reversalOfId, status: "PENDING" } });
    for (const line of input.lines) {
      if (!Number.isFinite(line.amount) || toMinor(line.amount) <= 0) throw new BadRequestException("Ledger amount must be positive");
      await tx.ledgerEntry.create({ data: { transactionId: row.id, accountId: line.accountId, direction: line.direction, amount: line.amount } });
      await tx.financialAccount.update({ where: { id: line.accountId }, data: { balanceCache: { increment: line.direction === "CREDIT" ? line.amount : -line.amount } } });
    }
    return tx.ledgerTransaction.update({ where: { id: row.id }, data: { status: "POSTED", postedAt: new Date() }, include: { entries: true } });
  }

  async settleTrip(tripId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { driver: { select: { userId: true } } } });
        if (!trip || trip.status !== "COMPLETED" || !trip.driver || trip.fare == null) throw new NotFoundException("Completed settleable trip not found");
        const gross = Number(trip.fare); const commission = Math.round(gross * 0.15 * 100) / 100; const net = Math.round((gross - commission) * 100) / 100;
        const driver = await this.userAccount(tx, trip.driver.userId, trip.currency);
        const revenue = await this.platformAccount(tx, "COMMISSION", "REVENUE", trip.currency);
        const debit = trip.paymentMethod === "WALLET"
          ? await this.userAccount(tx, trip.passengerId, trip.currency)
          : trip.paymentMethod === "CARD"
            ? await this.platformAccount(tx, "CARD_RECEIVABLE", "ASSET", trip.currency)
            : await this.platformAccount(tx, "CASH_CLEARING", "ASSET", trip.currency);
        await this.post(tx, { command: "settleTrip", idempotencyKey: `trip:settle:${tripId}`, currency: trip.currency, referenceType: "TRIP", referenceId: tripId, lines: [
          { accountId: debit.id, direction: "DEBIT", amount: gross }, { accountId: driver.id, direction: "CREDIT", amount: net }, { accountId: revenue.id, direction: "CREDIT", amount: commission },
        ] });
        await tx.payment.upsert({ where: { tripId }, create: { tripId, userId: trip.passengerId, amount: gross, method: trip.paymentMethod, status: trip.paymentMethod === "CARD" ? "PENDING" : "PAID" }, update: {} });
        await tx.driverEarning.upsert({ where: { tripId }, create: { driverId: trip.driverId as string, tripId, gross, commission, net }, update: {} });
        await tx.companyEarning.upsert({ where: { tripId }, create: { tripId, amount: commission, source: "ledger_projection" }, update: {} });
        await tx.trip.update({ where: { id: tripId }, data: { settledAt: new Date(), settlementError: null, settlementAttempts: { increment: 1 } } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.prisma.trip.updateMany({ where: { id: tripId, settledAt: null }, data: { settlementAttempts: { increment: 1 }, settlementError: error instanceof Error ? error.message.slice(0, 500) : "Unknown settlement error" } });
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryUnsettledTrips(): Promise<void> {
    const trips = await this.prisma.trip.findMany({ where: { status: "COMPLETED", settledAt: null, settlementAttempts: { lt: 20 } }, select: { id: true }, orderBy: { completedAt: "asc" }, take: 100 });
    for (const trip of trips) { try { await this.settleTrip(trip.id); } catch (error) { this.logger.warn(`Settlement retry failed for ${trip.id}: ${error instanceof Error ? error.message : String(error)}`); } }
  }

  async reserveWithdrawal(withdrawalId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawRequest.findUnique({ where: { id: withdrawalId } }); if (!request) throw new NotFoundException("Withdrawal not found");
      const user = await this.userAccount(tx, request.userId, "DZD"); if (Number(user.balanceCache) < Number(request.amount)) throw new BadRequestException("Insufficient funds");
      const reserve = await this.platformAccount(tx, "WITHDRAWAL_RESERVE", "LIABILITY", "DZD");
      await this.post(tx, { command: "reserveWithdrawal", idempotencyKey: `withdrawal:reserve:${withdrawalId}`, currency: "DZD", referenceType: "WITHDRAWAL", referenceId: withdrawalId, lines: [{ accountId: user.id, direction: "DEBIT", amount: Number(request.amount) }, { accountId: reserve.id, direction: "CREDIT", amount: Number(request.amount) }] });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async releaseWithdrawal(id: string): Promise<void> { const original = await this.byKey(`withdrawal:reserve:${id}`); await this.reverseTransaction(original.id, `withdrawal:release:${id}`, "releaseWithdrawal"); }
  async captureCardPayment(paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { trip: true } });
      if (!payment || payment.method !== "CARD") throw new NotFoundException("Card payment not found");
      if (!payment.trip || !payment.trip.settledAt) return;
      const cash = await this.platformAccount(tx, "CASH", "ASSET", payment.trip.currency);
      const receivable = await this.platformAccount(tx, "CARD_RECEIVABLE", "ASSET", payment.trip.currency);
      await this.post(tx, {
        command: "captureCardPayment",
        idempotencyKey: `payment:capture:${paymentId}`,
        currency: payment.trip.currency,
        referenceType: "PAYMENT",
        referenceId: paymentId,
        lines: [
          { accountId: cash.id, direction: "DEBIT", amount: Number(payment.amount) },
          { accountId: receivable.id, direction: "CREDIT", amount: Number(payment.amount) },
        ],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async refundPayment(id: string): Promise<void> {
    const original = await this.prisma.ledgerTransaction.findFirst({ where: { referenceType: "PAYMENT", referenceId: id, status: "POSTED" }, orderBy: { createdAt: "desc" } });
    if (!original) {
      this.logger.warn(`No posted payment ledger transaction found for refund ${id}`);
      return;
    }
    await this.reverseTransaction(original.id, `payment:refund:${id}`, "refundPayment");
  }
  async completeWithdrawal(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => { const request = await tx.withdrawRequest.findUnique({ where: { id } }); if (!request) throw new NotFoundException("Withdrawal not found"); const reserve = await this.platformAccount(tx, "WITHDRAWAL_RESERVE", "LIABILITY", "DZD"); const cash = await this.platformAccount(tx, "CASH", "ASSET", "DZD"); await this.post(tx, { command: "completeWithdrawal", idempotencyKey: `withdrawal:complete:${id}`, currency: "DZD", referenceType: "WITHDRAWAL", referenceId: id, lines: [{ accountId: reserve.id, direction: "DEBIT", amount: Number(request.amount) }, { accountId: cash.id, direction: "CREDIT", amount: Number(request.amount) }] }); });
  }
  async fundDriverWallet(requestId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.driverFundingRequest.findUnique({
        where: { id: requestId },
        include: { driver: { select: { userId: true } } },
      });
      if (!request) throw new NotFoundException("Driver funding request not found");
      if (request.status === "FUNDED") return;
      if (request.status !== "APPROVED") {
        throw new BadRequestException("Driver funding request must be approved first");
      }
      const user = await this.userAccount(tx, request.driver.userId, "DZD");
      const cash = await this.platformAccount(tx, "CASH", "ASSET", "DZD");
      await this.post(tx, {
        command: "fundDriverWallet",
        idempotencyKey: `driverFunding:fund:${requestId}`,
        currency: "DZD",
        referenceType: "DRIVER_FUNDING",
        referenceId: requestId,
        lines: [
          { accountId: cash.id, direction: "DEBIT", amount: Number(request.amount) },
          { accountId: user.id, direction: "CREDIT", amount: Number(request.amount) },
        ],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async transferDriverFunds(transferId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await tx.driverTransfer.findUnique({
        where: { id: transferId },
        include: {
          fromDriver: { select: { userId: true } },
          toDriver: { select: { userId: true } },
        },
      });
      if (!transfer) throw new NotFoundException("Driver transfer not found");
      if (transfer.status === "COMPLETED") return;
      if (transfer.status !== "APPROVED") {
        throw new BadRequestException("Driver transfer must be approved first");
      }
      const sender = await this.userAccount(tx, transfer.fromDriver.userId, "DZD");
      const receiver = await this.userAccount(tx, transfer.toDriver.userId, "DZD");
      if (Number(sender.balanceCache) < Number(transfer.amount)) {
        throw new BadRequestException("Insufficient funds for driver transfer");
      }
      await this.post(tx, {
        command: "transferDriverFunds",
        idempotencyKey: `driverTransfer:complete:${transferId}`,
        currency: "DZD",
        referenceType: "DRIVER_TRANSFER",
        referenceId: transferId,
        lines: [
          { accountId: sender.id, direction: "DEBIT", amount: Number(transfer.amount) },
          { accountId: receiver.id, direction: "CREDIT", amount: Number(transfer.amount) },
        ],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private async byKey(key: string) { const row = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: key } }); if (!row || row.status !== "POSTED") throw new NotFoundException("Posted ledger transaction not found"); return row; }
  async reverseTransaction(id: string, key: string, command = "reverseTransaction"): Promise<void> {
    await this.prisma.$transaction(async (tx) => { const original = await tx.ledgerTransaction.findUnique({ where: { id }, include: { entries: true, reversedBy: true } }); if (!original || original.status !== "POSTED") throw new BadRequestException("Only posted transactions can be reversed"); if (original.reversedBy) return; await this.post(tx, { command, idempotencyKey: key, currency: original.currency, referenceType: original.referenceType ?? undefined, referenceId: original.referenceId ?? undefined, reversalOfId: original.id, lines: original.entries.map((entry) => ({ accountId: entry.accountId, direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT", amount: Number(entry.amount) })) }); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async getUserBalance(userId: string, currency = "DZD") { const account = await this.prisma.financialAccount.findUnique({ where: { code: `USER:${userId}:${currency}:AVAILABLE` } }); return { balance: Number(account?.balanceCache ?? 0), currency }; }
  async listAccounts(page: number, limit: number, search?: string) { const where: Prisma.FinancialAccountWhereInput = search ? { OR: [{ code: { contains: search, mode: "insensitive" } }, { party: { displayName: { contains: search, mode: "insensitive" } } }] } : {}; const [items,total]=await this.prisma.$transaction([this.prisma.financialAccount.findMany({where,include:{party:true},orderBy:{updatedAt:"desc"},skip:(page-1)*limit,take:limit}),this.prisma.financialAccount.count({where})]); return {items,total,page,limit}; }
  async listTransactions(
    page: number,
    limit: number,
    status?: "PENDING" | "POSTED" | "FAILED" | "REVERSED" | "CANCELLED",
    referenceType?: string,
    search?: string,
  ) {
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(status ? { status } : {}),
      ...(referenceType ? { referenceType } : {}),
      ...(search
        ? {
            OR: [
              { command: { contains: search, mode: "insensitive" } },
              { idempotencyKey: { contains: search, mode: "insensitive" } },
              { referenceId: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ledgerTransaction.findMany({
        where,
        include: {
          entries: { include: { account: { include: { party: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ledgerTransaction.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
