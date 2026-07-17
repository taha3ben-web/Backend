import { DEFAULT_CURRENCY } from "../../common/money.util";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { FinancialService } from "../financial/financial.service";

export interface DateRange {
  from?: string;
  to?: string;
}

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  range(r: DateRange): { gte: Date; lte: Date } {
    const to = r.to ? new Date(r.to) : new Date();
    const from = r.from
      ? new Date(r.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { gte: from, lte: to };
  }

  async overview(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalTrips,
      completedTrips,
      cancelledTrips,
      newPassengers,
      newDrivers,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { createdAt } }),
      this.prisma.trip.count({ where: { createdAt, status: "COMPLETED" } }),
      this.prisma.trip.count({ where: { createdAt, status: "CANCELLED" } }),
      this.prisma.user.count({ where: { createdAt, type: "PASSENGER" } }),
      this.prisma.driver.count({ where: { createdAt } }),
    ]);
    const completionRate =
      totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;
    return {
      range: createdAt,
      totalTrips,
      completedTrips,
      cancelledTrips,
      completionRate,
      newPassengers,
      newDrivers,
    };
  }

  async revenue(r: DateRange) {
    const createdAt = this.range(r);
    // Company/driver revenue derived from the Ledger (single source of truth);
    // payments collected and withdrawals paid stay as operational aggregates.
    const ledger = await this.financial.getLedgerRevenue({
      gte: createdAt.gte,
      lte: createdAt.lte,
    });
    const [payments, withdrawals] = await this.prisma.$transaction([
      this.prisma.payment.aggregate({
        where: { createdAt, status: { in: ["PAID", "CAPTURED"] } },
        _sum: { amount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { createdAt, status: "PAID" },
        _sum: { amount: true },
      }),
    ]);
    return {
      companyEarnings: this.num(ledger.commission),
      driverGross: this.num(ledger.gross),
      commissions: this.num(ledger.commission),
      driverNet: this.num(ledger.driverNet),
      paymentsCollected: this.num(payments._sum.amount),
      withdrawalsPaid: this.num(withdrawals._sum.amount),
    };
  }

  async paymentOps(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalCount,
      totalAmount,
      capturedAmount,
      pendingCount,
      failedCount,
      refundedCount,
    ] = await this.prisma.$transaction([
      this.prisma.payment.count({ where: { createdAt } }),
      this.prisma.payment.aggregate({ where: { createdAt }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({
        where: { createdAt, status: { in: ["CAPTURED", "PAID"] } },
        _sum: { amount: true },
      }),
      this.prisma.payment.count({
        where: { createdAt, status: { in: ["PENDING", "AUTHORIZED"] } },
      }),
      this.prisma.payment.count({ where: { createdAt, status: "FAILED" } }),
      this.prisma.payment.count({ where: { createdAt, status: "REFUNDED" } }),
    ]);

    return {
      totalCount,
      totalAmount: this.num(totalAmount._sum.amount),
      capturedAmount: this.num(capturedAmount._sum.amount),
      pendingCount,
      failedCount,
      refundedCount,
    };
  }

  async settlementOps(r: DateRange) {
    const completedAt = this.range(r);
    const [
      completedTrips,
      settledTrips,
      unsettledTrips,
      failedSettlements,
      attempts,
    ] = await this.prisma.$transaction([
      this.prisma.trip.count({ where: { completedAt, status: "COMPLETED" } }),
      this.prisma.trip.count({
        where: { completedAt, status: "COMPLETED", settledAt: { not: null } },
      }),
      this.prisma.trip.count({
        where: { completedAt, status: "COMPLETED", settledAt: null },
      }),
      this.prisma.trip.count({
        where: {
          completedAt,
          status: "COMPLETED",
          settledAt: null,
          settlementError: { not: null },
        },
      }),
      this.prisma.trip.aggregate({
        where: { completedAt, status: "COMPLETED" },
        _sum: { settlementAttempts: true },
      }),
    ]);

    return {
      completedTrips,
      settledTrips,
      unsettledTrips,
      failedSettlements,
      settlementAttempts: Number(attempts._sum.settlementAttempts ?? 0),
    };
  }

  async withdrawalOps(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalCount,
      totalAmount,
      pendingCount,
      approvedCount,
      paidCount,
      rejectedCount,
    ] = await this.prisma.$transaction([
      this.prisma.withdrawRequest.count({ where: { createdAt } }),
      this.prisma.withdrawRequest.aggregate({
        where: { createdAt },
        _sum: { amount: true },
      }),
      this.prisma.withdrawRequest.count({ where: { createdAt, status: "PENDING" } }),
      this.prisma.withdrawRequest.count({ where: { createdAt, status: "APPROVED" } }),
      this.prisma.withdrawRequest.count({ where: { createdAt, status: "PAID" } }),
      this.prisma.withdrawRequest.count({ where: { createdAt, status: "REJECTED" } }),
    ]);

    return {
      totalCount,
      totalAmount: this.num(totalAmount._sum.amount),
      pendingCount,
      approvedCount,
      paidCount,
      rejectedCount,
    };
  }

  async fundingOps(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalCount,
      totalAmount,
      pendingCount,
      approvedCount,
      fundedCount,
      rejectedCount,
      fundedAmount,
    ] = await this.prisma.$transaction([
      this.prisma.driverFundingRequest.count({ where: { createdAt } }),
      this.prisma.driverFundingRequest.aggregate({
        where: { createdAt },
        _sum: { amount: true },
      }),
      this.prisma.driverFundingRequest.count({
        where: { createdAt, status: "PENDING" },
      }),
      this.prisma.driverFundingRequest.count({
        where: { createdAt, status: "APPROVED" },
      }),
      this.prisma.driverFundingRequest.count({ where: { createdAt, status: "FUNDED" } }),
      this.prisma.driverFundingRequest.count({
        where: { createdAt, status: "REJECTED" },
      }),
      this.prisma.driverFundingRequest.aggregate({
        where: { createdAt, status: "FUNDED" },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalCount,
      totalAmount: this.num(totalAmount._sum.amount),
      pendingCount,
      approvedCount,
      fundedCount,
      rejectedCount,
      fundedAmount: this.num(fundedAmount._sum.amount),
    };
  }

  async transferOps(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalCount,
      totalAmount,
      pendingCount,
      approvedCount,
      completedCount,
      rejectedCount,
      completedAmount,
      flaggedCount,
    ] = await this.prisma.$transaction([
      this.prisma.driverTransfer.count({ where: { createdAt } }),
      this.prisma.driverTransfer.aggregate({
        where: { createdAt },
        _sum: { amount: true },
      }),
      this.prisma.driverTransfer.count({ where: { createdAt, status: "PENDING" } }),
      this.prisma.driverTransfer.count({
        where: { createdAt, status: "APPROVED" },
      }),
      this.prisma.driverTransfer.count({
        where: { createdAt, status: "COMPLETED" },
      }),
      this.prisma.driverTransfer.count({
        where: { createdAt, status: "REJECTED" },
      }),
      this.prisma.driverTransfer.aggregate({
        where: { createdAt, status: "COMPLETED" },
        _sum: { amount: true },
      }),
      this.prisma.driverTransfer.count({
        where: { createdAt, riskFlags: { not: Prisma.JsonNull } },
      }),
    ]);

    return {
      totalCount,
      totalAmount: this.num(totalAmount._sum.amount),
      pendingCount,
      approvedCount,
      completedCount,
      rejectedCount,
      completedAmount: this.num(completedAmount._sum.amount),
      flaggedCount,
    };
  }

  async financialHealth(r: DateRange) {
    const createdAt = this.range(r);
    const [
      totalTransactions,
      postedCount,
      pendingCount,
      failedCount,
      reversedCount,
      cancelledCount,
      tripReferences,
      paymentReferences,
      withdrawalReferences,
      fundingReferences,
      transferReferences,
      platformCash,
      withdrawalReserve,
      cardReceivable,
      userLiabilities,
    ] = await this.prisma.$transaction([
      this.prisma.ledgerTransaction.count({ where: { createdAt } }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, status: "POSTED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, status: "PENDING" },
      }),
      this.prisma.ledgerTransaction.count({ where: { createdAt, status: "FAILED" } }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, status: "REVERSED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, status: "CANCELLED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, referenceType: "TRIP", status: "POSTED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, referenceType: "PAYMENT", status: "POSTED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, referenceType: "WITHDRAWAL", status: "POSTED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, referenceType: "DRIVER_FUNDING", status: "POSTED" },
      }),
      this.prisma.ledgerTransaction.count({
        where: { createdAt, referenceType: "DRIVER_TRANSFER", status: "POSTED" },
      }),
      this.prisma.financialAccount.aggregate({
        where: { code: `PLATFORM:CASH:${DEFAULT_CURRENCY}` },
        _sum: { balanceCache: true },
      }),
      this.prisma.financialAccount.aggregate({
        where: { code: `PLATFORM:WITHDRAWAL_RESERVE:${DEFAULT_CURRENCY}` },
        _sum: { balanceCache: true },
      }),
      this.prisma.financialAccount.aggregate({
        where: { code: `PLATFORM:CARD_RECEIVABLE:${DEFAULT_CURRENCY}` },
        _sum: { balanceCache: true },
      }),
      this.prisma.financialAccount.aggregate({
        where: { code: { startsWith: "USER:", endsWith: `:${DEFAULT_CURRENCY}:AVAILABLE` } },
        _sum: { balanceCache: true },
      }),
    ]);

    return {
      totalTransactions,
      postedCount,
      pendingCount,
      failedCount,
      reversedCount,
      cancelledCount,
      tripReferences,
      paymentReferences,
      withdrawalReferences,
      fundingReferences,
      transferReferences,
      platformCash: this.num(platformCash._sum.balanceCache),
      withdrawalReserve: this.num(withdrawalReserve._sum.balanceCache),
      cardReceivable: this.num(cardReceivable._sum.balanceCache),
      userLiabilities: this.num(userLiabilities._sum.balanceCache),
    };
  }

  async topDrivers(r: DateRange, limit = 10) {
    const createdAt = this.range(r);
    // Per-driver read model derived from the Ledger (rebuildable via FinancialService).
    const grouped = await this.prisma.driverEarning.groupBy({
      by: ["driverId"],
      where: { createdAt },
      _sum: { net: true },
      _count: { tripId: true },
      orderBy: { _sum: { net: "desc" } },
      take: limit,
    });
    const ids = grouped.map((g) => g.driverId);
    const drivers = await this.prisma.driver.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { name: true, phone: true } } },
    });
    const map = new Map(drivers.map((d) => [d.id, d]));
    return grouped.map((g) => ({
      driverId: g.driverId,
      name: map.get(g.driverId)?.user.name ?? "—",
      phone: map.get(g.driverId)?.user.phone ?? "—",
      rating: map.get(g.driverId)?.rating ?? 0,
      trips: g._count.tripId,
      netEarnings: this.num(g._sum.net),
    }));
  }

  async topCities(r: DateRange, limit = 10) {
    const createdAt = this.range(r);
    const grouped = await this.prisma.trip.groupBy({
      by: ["cityId"],
      where: { createdAt, cityId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });
    const ids = grouped
      .map((g) => g.cityId)
      .filter((c): c is string => c != null);
    const cities = await this.prisma.city.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const map = new Map(cities.map((c) => [c.id, c.name]));
    return grouped.map((g) => ({
      cityId: g.cityId,
      name: g.cityId ? (map.get(g.cityId) ?? "—") : "—",
      trips: g._count.id,
    }));
  }

  async timeseries(r: DateRange) {
    const { gte, lte } = this.range(r);
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; trips: bigint; revenue: Prisma.Decimal | null }>
    >`
      SELECT date_trunc('day', t."createdAt") AS day,
             COUNT(DISTINCT t.id) AS trips,
             COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' AND fa.code LIKE 'PLATFORM:COMMISSION:%' THEN le.amount ELSE 0 END), 0) AS revenue
      FROM "Trip" t
      LEFT JOIN "LedgerTransaction" lt ON lt."referenceId" = t.id AND lt."referenceType" = 'TRIP' AND lt.command = 'settleTrip' AND lt.status = 'POSTED'
      LEFT JOIN "LedgerEntry" le ON le."transactionId" = lt.id
      LEFT JOIN "FinancialAccount" fa ON fa.id = le."accountId"
      WHERE t."createdAt" >= ${gte} AND t."createdAt" <= ${lte}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((row) => ({
      day: row.day,
      trips: Number(row.trips),
      revenue: this.num(row.revenue),
    }));
  }

  private num(
    v: Prisma.Decimal | number | bigint | null | undefined,
  ): number {
    return v ? Number(v) : 0;
  }
}
