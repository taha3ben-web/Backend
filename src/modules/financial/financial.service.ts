import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { FinancialAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { FinancialCommand, PostingLine } from "./financial.types";

const PLATFORM_PARTY_ID = "00000000-0000-0000-0000-000000000001";

@Injectable()
export class FinancialService {
  constructor(private readonly prisma: PrismaService) {}

  private assertBalanced(lines: PostingLine[]): void {
    if (lines.length < 2) throw new BadRequestException("Ledger transaction needs at least two entries");
    const debit = lines.filter((line) => line.direction === "DEBIT").reduce((sum, line) => sum + line.amount, 0);
    const credit = lines.filter((line) => line.direction === "CREDIT").reduce((sum, line) => sum + line.amount, 0);
    if (debit <= 0 || Math.round(debit * 100) !== Math.round(credit * 100)) {
      throw new BadRequestException("Unbalanced ledger transaction");
    }
  }

  private async userAccount(tx: Prisma.TransactionClient, userId: string, currency: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundException("Financial party user not found");
    const party = await tx.financialParty.upsert({
      where: { userId },
      create: { type: "USER", userId, displayName: user.name },
      update: { displayName: user.name },
    });
    return tx.financialAccount.upsert({
      where: { code: `USER:${userId}:${currency}:AVAILABLE` },
      create: { partyId: party.id, code: `USER:${userId}:${currency}:AVAILABLE`, type: "LIABILITY", currency },
      update: { isActive: true },
    });
  }

  private async platformAccount(tx: Prisma.TransactionClient, code: string, type: FinancialAccountType, currency: string) {
    const party = await tx.financialParty.upsert({
      where: { id: PLATFORM_PARTY_ID },
      create: { id: PLATFORM_PARTY_ID, type: "PLATFORM", displayName: "NOVA Ride" },
      update: {},
    });
    return tx.financialAccount.upsert({
      where: { code: `PLATFORM:${code}:${currency}` },
      create: { partyId: party.id, code: `PLATFORM:${code}:${currency}`, type, currency },
      update: { isActive: true },
    });
  }

  private async post(tx: Prisma.TransactionClient, command: FinancialCommand) {
    this.assertBalanced(command.lines);
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { entries: true } });
    if (existing) return existing;
    const transaction = await tx.ledgerTransaction.create({
      data: { command: command.command, idempotencyKey: command.idempotencyKey, currency: command.currency, referenceType: command.referenceType, referenceId: command.referenceId, metadata: command.metadata, status: "PENDING" },
    });
    for (const line of command.lines) {
      if (!Number.isFinite(line.amount) || line.amount <= 0) throw new BadRequestException("Ledger amount must be positive");
      await tx.ledgerEntry.create({ data: { transactionId: transaction.id, accountId: line.accountId, direction: line.direction, amount: line.amount } });
      const delta = line.direction === "CREDIT" ? line.amount : -line.amount;
      await tx.financialAccount.update({ where: { id: line.accountId }, data: { balanceCache: { increment: delta } } });
    }
    return tx.ledgerTransaction.update({ where: { id: transaction.id }, data: { status: "POSTED", postedAt: new Date() }, include: { entries: true } });
  }

  async settleTrip(tripId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { driver: { select: { userId: true } } } });
      if (!trip || !trip.driver || trip.fare == null) throw new NotFoundException("Settleable trip not found");
      const gross = Number(trip.fare);
      const commission = Math.round(gross * 0.15 * 100) / 100;
      const net = Math.round((gross - commission) * 100) / 100;
      const passenger = await this.userAccount(tx, trip.passengerId, trip.currency);
      const driver = await this.userAccount(tx, trip.driver.userId, trip.currency);
      const revenue = await this.platformAccount(tx, "COMMISSION", "REVENUE", trip.currency);
      await this.post(tx, { command: "settleTrip", idempotencyKey: `trip:settle:${tripId}`, currency: trip.currency, referenceType: "TRIP", referenceId: tripId, lines: [
        { accountId: passenger.id, direction: "DEBIT", amount: gross },
        { accountId: driver.id, direction: "CREDIT", amount: net },
        { accountId: revenue.id, direction: "CREDIT", amount: commission },
      ] });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reserveWithdrawal(withdrawalId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawRequest.findUnique({ where: { id: withdrawalId } });
      if (!request) throw new NotFoundException("Withdrawal not found");
      const user = await this.userAccount(tx, request.userId, "DZD");
      if (Number(user.balanceCache) < Number(request.amount)) throw new BadRequestException("Insufficient funds");
      const reserve = await this.platformAccount(tx, "WITHDRAWAL_RESERVE", "LIABILITY", "DZD");
      await this.post(tx, { command: "reserveWithdrawal", idempotencyKey: `withdrawal:reserve:${withdrawalId}`, currency: "DZD", referenceType: "WITHDRAWAL", referenceId: withdrawalId, lines: [
        { accountId: user.id, direction: "DEBIT", amount: Number(request.amount) },
        { accountId: reserve.id, direction: "CREDIT", amount: Number(request.amount) },
      ] });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async releaseWithdrawal(withdrawalId: string): Promise<void> { return this.reverseByKey(`withdrawal:reserve:${withdrawalId}`, `withdrawal:release:${withdrawalId}`, "releaseWithdrawal"); }
  async refundPayment(paymentId: string): Promise<void> { return this.reverseByReference("PAYMENT", paymentId, `payment:refund:${paymentId}`, "refundPayment"); }

  async completeWithdrawal(withdrawalId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawRequest.findUnique({ where: { id: withdrawalId } });
      if (!request) throw new NotFoundException("Withdrawal not found");
      const reserve = await this.platformAccount(tx, "WITHDRAWAL_RESERVE", "LIABILITY", "DZD");
      const cash = await this.platformAccount(tx, "CASH", "ASSET", "DZD");
      await this.post(tx, { command: "completeWithdrawal", idempotencyKey: `withdrawal:complete:${withdrawalId}`, currency: "DZD", referenceType: "WITHDRAWAL", referenceId: withdrawalId, lines: [
        { accountId: reserve.id, direction: "DEBIT", amount: Number(request.amount) },
        { accountId: cash.id, direction: "CREDIT", amount: Number(request.amount) },
      ] });
    });
  }

  private async reverseByReference(referenceType: string, referenceId: string, key: string, command: string): Promise<void> {
    const original = await this.prisma.ledgerTransaction.findFirst({ where: { referenceType, referenceId, status: "POSTED" }, orderBy: { createdAt: "desc" } });
    if (!original) throw new NotFoundException("Posted ledger transaction not found");
    return this.reverseTransaction(original.id, key, command);
  }

  private async reverseByKey(originalKey: string, key: string, command: string): Promise<void> {
    const original = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: originalKey } });
    if (!original) throw new NotFoundException("Posted ledger transaction not found");
    return this.reverseTransaction(original.id, key, command);
  }

  async reverseTransaction(transactionId: string, key: string, command = "reverseTransaction"): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const original = await tx.ledgerTransaction.findUnique({ where: { id: transactionId }, include: { entries: true } });
      if (!original || original.status !== "POSTED") throw new BadRequestException("Only posted transactions can be reversed");
      await this.post(tx, { command, idempotencyKey: key, currency: original.currency, referenceType: original.referenceType ?? undefined, referenceId: original.referenceId ?? undefined, lines: original.entries.map((entry) => ({ accountId: entry.accountId, direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT", amount: Number(entry.amount) })) });
      await tx.ledgerTransaction.update({ where: { id: original.id }, data: { status: "REVERSED" } });
    });
  }

  async getUserBalance(userId: string, currency = "DZD") {
    const account = await this.prisma.financialAccount.findUnique({ where: { code: `USER:${userId}:${currency}:AVAILABLE` } });
    return { balance: Number(account?.balanceCache ?? 0), currency };
  }
}
