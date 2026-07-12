import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FundingRequestStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AuthUser } from "../../common/decorators/current-user.decorator";
import { FinancialService } from "../financial/financial.service";
import { CreateDriverFundingRequestDto } from "./dto/driver-funding.dto";

@Injectable()
export class DriverFundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async listRequests(
    actor: AuthUser,
    q: PaginationDto,
    status?: FundingRequestStatus,
    search?: string,
  ) {
    const where = await this.buildWhere(actor, status, search);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.driverFundingRequest.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: this.requestInclude(),
      }),
      this.prisma.driverFundingRequest.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async getRequest(actor: AuthUser, id: string) {
    const request = await this.prisma.driverFundingRequest.findUnique({
      where: { id },
      include: this.requestInclude(),
    });
    if (!request) throw new NotFoundException("طلب الشحن غير موجود");
    this.assertActorCanAccess(actor, request.requestedById);
    return request;
  }

  async createRequest(actor: AuthUser, dto: CreateDriverFundingRequestDto) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: dto.driverId },
      include: { user: { select: { id: true, name: true, phone: true } } },
    });
    if (!driver) throw new NotFoundException("السائق غير موجود");

    const resolvedIdempotencyKey =
      dto.idempotencyKey?.trim() ||
      `driver-funding:${actor.userId}:${dto.driverId}:${Math.round(dto.amount * 100)}`;

    const existing = await this.prisma.driverFundingRequest.findUnique({
      where: { idempotencyKey: resolvedIdempotencyKey },
      include: this.requestInclude(),
    });
    if (existing) {
      this.assertActorCanAccess(actor, existing.requestedById);
      return existing;
    }

    return this.prisma.driverFundingRequest.create({
      data: {
        driverId: dto.driverId,
        requestedById: actor.userId,
        amount: dto.amount,
        note: dto.note,
        idempotencyKey: resolvedIdempotencyKey,
        status: "PENDING",
      },
      include: this.requestInclude(),
    });
  }

  async approve(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const request = await this.getMutableRequest(id);
    if (request.status !== "PENDING") {
      throw new BadRequestException("لا يمكن اعتماد طلب تمت معالجته");
    }
    return this.prisma.driverFundingRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: actor.userId,
        approvedAt: new Date(),
        note: note ?? request.note,
      },
      include: this.requestInclude(),
    });
  }

  async reject(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const request = await this.getMutableRequest(id);
    if (request.status === "FUNDED") {
      throw new BadRequestException("لا يمكن رفض طلب تم شحنه");
    }
    if (request.status === "REJECTED") {
      return this.getRequest(actor, id);
    }
    return this.prisma.driverFundingRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedById: actor.userId,
        rejectedAt: new Date(),
        note: note ?? request.note,
      },
      include: this.requestInclude(),
    });
  }

  async markFunded(actor: AuthUser, id: string, note?: string) {
    this.assertStaff(actor);
    const request = await this.getMutableRequest(id);
    if (request.status === "FUNDED") {
      return this.getRequest(actor, id);
    }
    if (request.status !== "APPROVED") {
      throw new BadRequestException("يجب اعتماد الطلب قبل الشحن");
    }

    await this.financial.fundDriverWallet(id);

    return this.prisma.driverFundingRequest.update({
      where: { id },
      data: {
        status: "FUNDED",
        fundedAt: new Date(),
        note: note ?? request.note,
      },
      include: this.requestInclude(),
    });
  }

  private async getMutableRequest(id: string) {
    const request = await this.prisma.driverFundingRequest.findUnique({
      where: { id },
      include: { driver: { include: { user: true } } },
    });
    if (!request) throw new NotFoundException("طلب الشحن غير موجود");
    return request;
  }

  private assertActorCanAccess(actor: AuthUser, requestedById: string) {
    if (actor.role === "STAFF") return;
    if (actor.userId !== requestedById) {
      throw new ForbiddenException("لا يمكنك الوصول إلى هذا الطلب");
    }
  }

  private assertStaff(actor: AuthUser) {
    if (actor.role !== "STAFF") {
      throw new ForbiddenException("هذه العملية مخصصة للموظفين");
    }
  }

  private async buildWhere(
    actor: AuthUser,
    status?: FundingRequestStatus,
    search?: string,
  ): Promise<Prisma.DriverFundingRequestWhereInput> {
    return {
      ...(actor.role === "AGENT" ? { requestedById: actor.userId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { note: { contains: search, mode: "insensitive" } },
              { idempotencyKey: { contains: search, mode: "insensitive" } },
              { driver: { user: { name: { contains: search, mode: "insensitive" } } } },
              { driver: { user: { phone: { contains: search } } } },
              { requestedBy: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
  }

  private requestInclude() {
    return {
      driver: {
        include: {
          user: {
            select: { id: true, name: true, phone: true, type: true, status: true },
          },
        },
      },
      requestedBy: { select: { id: true, name: true, phone: true, type: true } },
      approvedBy: { select: { id: true, name: true, phone: true, type: true } },
    } satisfies Prisma.DriverFundingRequestInclude;
  }
}
