import { DEFAULT_CURRENCY, toMinorUnits } from "../../common/money.util";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DriverTransferStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AuthUser } from "../../common/decorators/current-user.decorator";
import { FinancialService } from "../financial/financial.service";
import { CreateDriverTransferDto } from "./dto/driver-transfer.dto";
import { BlacklistKind, RiskService } from "../risk/risk.service";

const TRANSFER_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRANSFER_VELOCITY_MAX_COUNT = 5;

@Injectable()
export class DriverTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
    private readonly risk: RiskService,
  ) {}

  async list(
    actor: AuthUser,
    q: PaginationDto,
    status?: DriverTransferStatus,
    search?: string,
  ) {
    const where = this.buildWhere(actor, status, search);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driverTransfer.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: this.includeShape(),
      }),
      this.prisma.driverTransfer.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async getOne(actor: AuthUser, id: string) {
    const transfer = await this.prisma.driverTransfer.findUnique({
      where: { id },
      include: this.includeShape(),
    });
    if (!transfer) throw new NotFoundException("طلب التحويل غير موجود");
    this.assertActorCanAccess(actor, transfer.requestedById);
    return transfer;
  }

  async create(actor: AuthUser, dto: CreateDriverTransferDto) {
    if (dto.fromDriverId === dto.toDriverId) {
      throw new BadRequestException("لا يمكن التحويل إلى نفس السائق");
    }
    const [fromDriver, toDriver] = await Promise.all([
      this.loadDriver(dto.fromDriverId),
      this.loadDriver(dto.toDriverId),
    ]);

    const idempotencyKey =
      dto.idempotencyKey?.trim() ||
      `driver-transfer:${actor.userId}:${dto.fromDriverId}:${dto.toDriverId}:${toMinorUnits(dto.amount)}`;

    const existing = await this.prisma.driverTransfer.findUnique({
      where: { idempotencyKey },
      include: this.includeShape(),
    });
    if (existing) {
      this.assertActorCanAccess(actor, existing.requestedById);
      return existing;
    }

    await this.enforceDailyLimits(dto.fromDriverId, dto.amount);

    const balance = await this.financial.getUserBalance(
      fromDriver.userId,
      DEFAULT_CURRENCY,
    );
    if (balance.balance < dto.amount) {
      throw new BadRequestException("رصيد السائق المرسل غير كافٍ");
    }

    await this.assessTransferRisk(fromDriver, dto.amount);

    const riskFlags = this.computeRiskFlags(
      fromDriver,
      toDriver,
      dto.amount,
      balance.balance,
    );

    return this.prisma.driverTransfer.create({
      data: {
        fromDriverId: dto.fromDriverId,
        toDriverId: dto.toDriverId,
        requestedById: actor.userId,
        amount: dto.amount,
        status: "PENDING",
        note: dto.note,
        idempotencyKey,
        riskFlags:
          riskFlags.length > 0
            ? (riskFlags as Prisma.InputJsonValue)
            : undefined,
      },
      include: this.includeShape(),
    });
  }

  async approve(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const transfer = await this.getMutable(id);
    if (transfer.status !== "PENDING") {
      throw new BadRequestException("لا يمكن اعتماد تحويل تمت معالجته");
    }
    return this.prisma.driverTransfer.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedById: actor.userId,
        approvedAt: new Date(),
        note: note ?? transfer.note,
      },
      include: this.includeShape(),
    });
  }

  async reject(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const transfer = await this.getMutable(id);
    if (transfer.status === "COMPLETED") {
      throw new BadRequestException("لا يمكن رفض تحويل مكتمل");
    }
    if (transfer.status === "REJECTED") {
      return this.getOne(actor, id);
    }
    return this.prisma.driverTransfer.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedById: actor.userId,
        rejectedAt: new Date(),
        note: note ?? transfer.note,
      },
      include: this.includeShape(),
    });
  }

  async complete(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const transfer = await this.getMutable(id);
    if (transfer.status === "COMPLETED") {
      return this.getOne(actor, id);
    }
    if (transfer.status !== "APPROVED") {
      throw new BadRequestException("يجب اعتماد التحويل قبل تنفيذه");
    }

    await this.financial.transferDriverFunds(id);

    return this.prisma.driverTransfer.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        note: note ?? transfer.note,
      },
      include: this.includeShape(),
    });
  }

  private buildWhere(
    actor: AuthUser,
    status?: DriverTransferStatus,
    search?: string,
  ): Prisma.DriverTransferWhereInput {
    return {
      ...(actor.role === "AGENT" ? { requestedById: actor.userId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { note: { contains: search, mode: "insensitive" } },
              { idempotencyKey: { contains: search, mode: "insensitive" } },
              {
                fromDriver: {
                  user: { name: { contains: search, mode: "insensitive" } },
                },
              },
              { fromDriver: { user: { phone: { contains: search } } } },
              {
                toDriver: {
                  user: { name: { contains: search, mode: "insensitive" } },
                },
              },
              { toDriver: { user: { phone: { contains: search } } } },
            ],
          }
        : {}),
    };
  }

  private async loadDriver(driverId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: {
        user: { select: { id: true, name: true, phone: true, status: true } },
        city: { select: { id: true, name: true } },
      },
    });
    if (!driver) throw new NotFoundException("السائق غير موجود");
    if (driver.status !== "APPROVED") {
      throw new BadRequestException("السائق يجب أن يكون معتمدًا قبل التحويل");
    }
    return driver;
  }

  private async enforceDailyLimits(fromDriverId: string, amount: number) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const [count, aggregate] = await this.prisma.$transaction([
      this.prisma.driverTransfer.count({
        where: {
          fromDriverId,
          createdAt: { gte: start },
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
      }),
      this.prisma.driverTransfer.aggregate({
        where: {
          fromDriverId,
          createdAt: { gte: start },
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
        _sum: { amount: true },
      }),
    ]);

    const total = Number(aggregate._sum.amount ?? 0);
    if (count >= 5) {
      throw new BadRequestException("تم تجاوز الحد اليومي لعدد التحويلات");
    }
    if (total + amount > 50000) {
      throw new BadRequestException("تم تجاوز الحد اليومي لقيمة التحويلات");
    }
  }

  private async assessTransferRisk(
    fromDriver: Awaited<ReturnType<DriverTransfersService["loadDriver"]>>,
    amount: number,
  ) {
    const now = Date.now();
    const windowStart = new Date(now - TRANSFER_VELOCITY_WINDOW_MS);
    const [recent, aggregate] = await this.prisma.$transaction([
      this.prisma.driverTransfer.findMany({
        where: {
          fromDriverId: fromDriver.id,
          createdAt: { gte: windowStart },
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
        select: { createdAt: true, amount: true },
      }),
      this.prisma.driverTransfer.aggregate({
        where: {
          fromDriverId: fromDriver.id,
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
        _avg: { amount: true },
      }),
    ]);

    const history = recent.map((r) => ({
      at: r.createdAt.getTime(),
      amount: Number(r.amount),
    }));
    const avgAmount = Number(aggregate._avg.amount ?? 0) || undefined;

    const blacklistChecks: Array<{ kind: BlacklistKind; value: string }> = [
      { kind: "USER", value: fromDriver.userId },
    ];
    if (fromDriver.user?.phone) {
      blacklistChecks.push({ kind: "PHONE", value: fromDriver.user.phone });
    }

    const assessment = await this.risk.assess({
      subjectKind: "USER",
      subjectId: fromDriver.userId,
      action: "driver-transfer.create",
      amount,
      avgAmount,
      blacklistChecks,
      velocity: {
        history,
        limit: {
          windowMs: TRANSFER_VELOCITY_WINDOW_MS,
          maxCount: TRANSFER_VELOCITY_MAX_COUNT,
        },
        now,
      },
    });

    if (RiskService.shouldBlock(assessment.decision)) {
      throw new ForbiddenException(
        "تم رفض التحويل لأسباب أمنية. يُرجى التواصل مع الدعم.",
      );
    }
  }

  private computeRiskFlags(
    fromDriver: Awaited<ReturnType<DriverTransfersService["loadDriver"]>>,
    toDriver: Awaited<ReturnType<DriverTransfersService["loadDriver"]>>,
    amount: number,
    currentBalance: number,
  ) {
    const flags: string[] = [];
    if (amount >= 10000) flags.push("HIGH_AMOUNT");
    if (
      fromDriver.cityId &&
      toDriver.cityId &&
      fromDriver.cityId !== toDriver.cityId
    ) {
      flags.push("CROSS_CITY_TRANSFER");
    }
    if (currentBalance - amount < 500) flags.push("LOW_BALANCE_AFTER_TRANSFER");
    return flags;
  }

  private async getMutable(id: string) {
    const transfer = await this.prisma.driverTransfer.findUnique({
      where: { id },
    });
    if (!transfer) throw new NotFoundException("طلب التحويل غير موجود");
    return transfer;
  }

  private assertActorCanAccess(actor: AuthUser, requestedById: string) {
    if (actor.role === "STAFF") return;
    if (actor.userId !== requestedById) {
      throw new ForbiddenException("لا يمكنك الوصول إلى هذا التحويل");
    }
  }

  private assertStaff(actor: AuthUser) {
    if (actor.role !== "STAFF") {
      throw new ForbiddenException("هذه العملية مخصصة للموظفين");
    }
  }

  private includeShape() {
    return {
      fromDriver: {
        include: {
          user: { select: { id: true, name: true, phone: true, status: true } },
          city: { select: { id: true, name: true } },
        },
      },
      toDriver: {
        include: {
          user: { select: { id: true, name: true, phone: true, status: true } },
          city: { select: { id: true, name: true } },
        },
      },
      requestedBy: {
        select: { id: true, name: true, phone: true, type: true },
      },
      reviewedBy: { select: { id: true, name: true, phone: true, type: true } },
    } satisfies Prisma.DriverTransferInclude;
  }
}
