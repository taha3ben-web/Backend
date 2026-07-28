import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FinancialAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { FinancialCommand, PostingLine } from "./financial.types";
import { DEFAULT_CURRENCY, toMinorUnits } from "../../common/money.util";

const PLATFORM_PARTY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * محرّك دفتر الأستاذ المزدوج: إنشاء الحسابات، ترحيل القيود المتوازنة،
 * عكس المعاملات، وقراءة الأرصدة. مستخرَج من FinancialService ليكون نواة
 * مالية قابلة للاختبار والمشاركة دون أي تغيير في السلوك (نفس الحسابات
 * ونفس مفاتيح الخمول idempotency ونفس منطق الترحيل حرفيًا).
 */
@Injectable()
export class LedgerCoreService {
  constructor(private readonly prisma: PrismaService) {}

  assertCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException("Invalid ISO currency");
  }

  assertBalanced(lines: PostingLine[]): void {
    if (lines.length < 2)
      throw new BadRequestException(
        "Ledger transaction needs at least two entries",
      );
    const debit = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + toMinorUnits(line.amount), 0);
    const credit = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + toMinorUnits(line.amount), 0);
    if (debit <= 0 || debit !== credit)
      throw new BadRequestException("Unbalanced ledger transaction");
  }

  async userAccount(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException("Financial party user not found");
    const party = await tx.financialParty.upsert({
      where: { userId },
      create: { type: "USER", userId, displayName: user.name },
      update: { displayName: user.name },
    });
    const code = `USER:${userId}:${currency}:AVAILABLE`;
    return tx.financialAccount.upsert({
      where: { code },
      create: { partyId: party.id, code, type: "LIABILITY", currency },
      update: { isActive: true },
    });
  }

  /**
   * حساب المحفظة المقفلة للمستخدم (USER:...:LOCKED — LIABILITY): رصيد غير قابل
   * للسحب (تعويض خصم الكوبون الممنوح للسائق وتموّله الشركة). منفصل تمامًا
   * عن AVAILABLE فلا يدخل في فحص السحب/التحويل.
   */
  async lockedUserAccount(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException("Financial party user not found");
    const party = await tx.financialParty.upsert({
      where: { userId },
      create: { type: "USER", userId, displayName: user.name },
      update: { displayName: user.name },
    });
    const code = `USER:${userId}:${currency}:LOCKED`;
    return tx.financialAccount.upsert({
      where: { code },
      create: { partyId: party.id, code, type: "LIABILITY", currency },
      update: { isActive: true },
    });
  }

  async platformAccount(
    tx: Prisma.TransactionClient,
    codeSuffix: string,
    type: FinancialAccountType,
    currency: string,
  ) {
    const party = await tx.financialParty.upsert({
      where: { id: PLATFORM_PARTY_ID },
      create: {
        id: PLATFORM_PARTY_ID,
        type: "PLATFORM",
        displayName: "flaminGO",
      },
      update: {},
    });
    const code = `PLATFORM:${codeSuffix}:${currency}`;
    return tx.financialAccount.upsert({
      where: { code },
      create: { partyId: party.id, code, type, currency },
      update: { isActive: true },
    });
  }

  async post(tx: Prisma.TransactionClient, input: FinancialCommand) {
    this.assertCurrency(input.currency);
    this.assertBalanced(input.lines);
    const existing = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existing) return existing;
    const row = await tx.ledgerTransaction.create({
      data: {
        command: input.command,
        idempotencyKey: input.idempotencyKey,
        currency: input.currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reversalOfId: input.reversalOfId,
        createdBy: input.createdBy ?? "SYSTEM",
        reason: input.reason,
        status: "PENDING",
      },
    });
    for (const line of input.lines) {
      if (!Number.isFinite(line.amount) || toMinorUnits(line.amount) <= 0)
        throw new BadRequestException("Ledger amount must be positive");
      // نحدّث الرصيد أولاً لالتقاط balanceAfter (لقطة الرصيد الجاري بعد هذا القيد)
      const account = await tx.financialAccount.update({
        where: { id: line.accountId },
        data: {
          balanceCache: {
            increment: line.direction === "CREDIT" ? line.amount : -line.amount,
          },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          transactionId: row.id,
          accountId: line.accountId,
          direction: line.direction,
          amount: line.amount,
          currency: account.currency,
          role: line.role ?? account.type,
          balanceAfter: account.balanceCache,
        },
      });
    }
    return tx.ledgerTransaction.update({
      where: { id: row.id },
      data: { status: "POSTED", postedAt: new Date() },
      include: { entries: true },
    });
  }

  async byKey(key: string) {
    const row = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: key },
    });
    if (!row || row.status !== "POSTED")
      throw new NotFoundException("Posted ledger transaction not found");
    return row;
  }

  async reverseTransaction(
    id: string,
    key: string,
    command = "reverseTransaction",
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const original = await tx.ledgerTransaction.findUnique({
          where: { id },
          include: { entries: true, reversedBy: true },
        });
        if (!original || original.status !== "POSTED")
          throw new BadRequestException(
            "Only posted transactions can be reversed",
          );
        if (original.reversedBy) return;
        await this.post(tx, {
          command,
          idempotencyKey: key,
          currency: original.currency,
          referenceType: original.referenceType ?? undefined,
          referenceId: original.referenceId ?? undefined,
          reversalOfId: original.id,
          lines: original.entries.map((entry) => ({
            accountId: entry.accountId,
            direction: entry.direction === "DEBIT" ? "CREDIT" : "DEBIT",
            amount: Number(entry.amount),
          })),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getUserBalance(userId: string, currency = DEFAULT_CURRENCY) {
    const account = await this.prisma.financialAccount.findUnique({
      where: { code: `USER:${userId}:${currency}:AVAILABLE` },
    });
    return { balance: Number(account?.balanceCache ?? 0), currency };
  }

  /**
   * الرصيد المقفل غير القابل للسحب (USER:...:LOCKED) — مثل تعويض خصم
   * الكوبون الممنوح للسائق. منفصل عن الرصيد المتاح فلا يدخل السحب/التحويل.
   */
  async getLockedBalance(userId: string, currency = DEFAULT_CURRENCY) {
    const account = await this.prisma.financialAccount.findUnique({
      where: { code: `USER:${userId}:${currency}:LOCKED` },
    });
    return { locked: Number(account?.balanceCache ?? 0), currency };
  }
}
