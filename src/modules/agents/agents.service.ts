import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AgentStatus, Prisma, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AssignAgentRoleDto,
  CreateAgentDto,
  UpdateAgentDto,
  UpdateAgentPasswordDto,
} from "./dto/agents.dto";

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async managementOptions() {
    const [roles, cities] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where: { name: { not: "SUPER_ADMIN" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.city.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    return { roles, cities };
  }

  async listAgents(q: PaginationDto, status?: AgentStatus, cityId?: string) {
    const where: Prisma.AgentProfileWhereInput = {
      ...(status ? { status } : {}),
      ...(cityId ? { cityId } : {}),
      ...(q.search
        ? {
            OR: [
              { agentCode: { contains: q.search, mode: "insensitive" } },
              { user: { name: { contains: q.search, mode: "insensitive" } } },
              { user: { phone: { contains: q.search } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.agentProfile.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: this.agentSelect(),
      }),
      this.prisma.agentProfile.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async getAgent(id: string) {
    const agent = await this.prisma.agentProfile.findUnique({
      where: { id },
      select: this.agentSelect(),
    });
    if (!agent) throw new NotFoundException("الوكيل غير موجود");
    return agent;
  }

  async getOwnProfile(userId: string) {
    const agent = await this.prisma.agentProfile.findUnique({
      where: { userId },
      select: this.agentSelect(),
    });
    if (!agent) throw new NotFoundException("ملف الوكيل غير موجود");
    return agent;
  }

  async createAgent(dto: CreateAgentDto, createdById?: string) {
    await this.ensurePhoneAvailable(dto.phone);
    await this.ensureAgentCodeAvailable(dto.agentCode);
    await this.ensureRoleExists(dto.roleId);
    if (dto.cityId) await this.ensureCityExists(dto.cityId);

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          passwordHash,
          type: "AGENT",
          status: "PENDING",
          staffRoleId: dto.roleId,
        },
      });

      return tx.agentProfile.create({
        data: {
          userId: user.id,
          agentCode: dto.agentCode.trim().toUpperCase(),
          cityId: dto.cityId,
          notes: dto.notes,
          createdById,
          status: "INVITED",
        },
        select: this.agentSelect(),
      });
    });
  }

  async updateAgent(id: string, dto: UpdateAgentDto) {
    const existing = await this.prisma.agentProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        agentCode: true,
        user: { select: { phone: true } },
      },
    });
    if (!existing) throw new NotFoundException("الوكيل غير موجود");
    if (dto.cityId) await this.ensureCityExists(dto.cityId);
    if (dto.phone && dto.phone !== existing.user.phone) {
      await this.ensurePhoneAvailable(dto.phone);
    }
    if (
      dto.agentCode &&
      dto.agentCode.trim().toUpperCase() !== existing.agentCode
    ) {
      await this.ensureAgentCodeAvailable(dto.agentCode);
    }

    const userStatus = this.mapAgentStatusToUserStatus(dto.status);

    return this.prisma.$transaction(async (tx) => {
      if (userStatus || dto.name !== undefined || dto.phone !== undefined) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(userStatus ? { status: userStatus } : {}),
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          },
        });
      }

      if (dto.status && dto.status !== "ACTIVE") {
        await tx.refreshToken.updateMany({
          where: { userId: existing.userId, revoked: false },
          data: { revoked: true },
        });
        await tx.session.deleteMany({ where: { userId: existing.userId } });
      }

      return tx.agentProfile.update({
        where: { id },
        data: {
          ...(dto.agentCode !== undefined
            ? { agentCode: dto.agentCode.trim().toUpperCase() }
            : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.cityId !== undefined ? { cityId: dto.cityId || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        select: this.agentSelect(),
      });
    });
  }

  async assignRole(id: string, dto: AssignAgentRoleDto) {
    const agent = await this.prisma.agentProfile.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!agent) throw new NotFoundException("الوكيل غير موجود");
    await this.ensureRoleExists(dto.roleId);

    await this.prisma.user.update({
      where: { id: agent.userId },
      data: { staffRoleId: dto.roleId },
    });

    return this.getAgent(id);
  }

  async updatePassword(id: string, dto: UpdateAgentPasswordDto) {
    const agent = await this.prisma.agentProfile.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!agent) throw new NotFoundException("الوكيل غير موجود");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: agent.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: agent.userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.deleteMany({ where: { userId: agent.userId } }),
    ]);

    return { ok: true };
  }

  async auditTrail(id: string, q: PaginationDto) {
    await this.getAgent(id);
    const where: Prisma.AuditLogWhereInput = {
      entity: "agents",
      entityId: id,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true, type: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  private async ensurePhoneAvailable(phone: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (user) throw new BadRequestException("رقم الهاتف مستخدم مسبقًا");
  }

  private async ensureAgentCodeAvailable(agentCode: string) {
    const code = agentCode.trim().toUpperCase();
    const existing = await this.prisma.agentProfile.findUnique({
      where: { agentCode: code },
      select: { id: true },
    });
    if (existing) throw new BadRequestException("رمز الوكيل مستخدم مسبقًا");
  }

  private async ensureRoleExists(roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, name: { not: "SUPER_ADMIN" } },
    });
    if (!role) throw new NotFoundException("الدور غير موجود");
  }

  private async ensureCityExists(cityId: string) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) throw new NotFoundException("المدينة غير موجودة");
  }

  private mapAgentStatusToUserStatus(
    status?: AgentStatus,
  ): UserStatus | undefined {
    if (!status) return undefined;
    if (status === "SUSPENDED") return "SUSPENDED";
    if (status === "INVITED") return "PENDING";
    return "ACTIVE";
  }

  private agentSelect() {
    return {
      id: true,
      agentCode: true,
      status: true,
      notes: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      city: { select: { id: true, name: true, country: true } },
      createdBy: { select: { id: true, name: true, type: true } },
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          type: true,
          staffRole: {
            select: {
              id: true,
              name: true,
              permissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
        },
      },
    } satisfies Prisma.AgentProfileSelect;
  }
}
