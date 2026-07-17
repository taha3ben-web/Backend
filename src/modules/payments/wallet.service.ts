import { DEFAULT_CURRENCY } from "../../common/money.util";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async getWithTransactions(userId: string, q: PaginationDto) {
    const balance = await this.financial.getUserBalance(userId);
    const locked = await this.financial.getLockedBalance(userId);
    const account = await this.prisma.financialAccount.findUnique({
      where: { code: `USER:${userId}:${DEFAULT_CURRENCY}:AVAILABLE` },
    });
    const where = account
      ? {
          accountId: account.id,
          transaction: { status: "POSTED" as const },
        }
      : {
          accountId: "__none__",
          transaction: { status: "POSTED" as const },
        };
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.findMany({
        where,
        include: { transaction: true },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return {
      ...balance,
      lockedBalance: locked.locked,
      source: "LEDGER" as const,
      transactions: entries,
      total,
      page: q.page,
      limit: q.limit,
    };
  }
}
