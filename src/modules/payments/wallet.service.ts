import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, Wallet, WalletTxType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** يجلب محفظة المستخدم أو ينشئها إن لم توجد */
  async getOrCreate(userId: string): Promise<Wallet> {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { userId } });
  }

  /** رصيد + آخر الحركات */
  async getWithTransactions(userId: string, q: PaginationDto) {
    const wallet = await this.getOrCreate(userId);
    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);
    return { wallet, transactions, total, page: q.page, limit: q.limit };
  }

  /**
   * تعديل الرصيد ذريًا (atomic) مع تسجيل حركة.
   * يمكن تمرير معاملة Prisma خارجية لضمان التزامن مع عمليات أخرى.
   */
  async adjust(
    userId: string,
    type: WalletTxType,
    amount: number,
    reason?: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("المبلغ يجب أن يكون أكبر من صفر");
    }

    const run = async (client: Prisma.TransactionClient) => {
      const wallet =
        (await client.wallet.findUnique({ where: { userId } })) ??
        (await client.wallet.create({ data: { userId } }));

      const delta = type === "CREDIT" ? amount : -amount;
      const current = Number(wallet.balance);
      const next = current + delta;
      if (next < 0) {
        throw new BadRequestException("الرصيد غير كافٍ");
      }

      const updated = await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: next },
      });

      const transaction = await client.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type,
          amount,
          balanceAfter: next,
          reason,
        },
      });

      return { wallet: updated, transaction };
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }
}
