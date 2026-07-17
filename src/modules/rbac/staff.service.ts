import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AssignRoleDto,
  CreateStaffDto,
  UpdateStaffPasswordDto,
  UpdateStaffStatusDto,
} from "./dto/rbac.dto";

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** إنشاء موظف (STAFF) وتعيين دور له */
  async createStaff(dto: CreateStaffDto) {
    const username = dto.username.trim().toLowerCase();
    const usernameTaken = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (usernameTaken) throw new BadRequestException("اسم المستخدم مستخدم مسبقًا");
    const phoneTaken = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (phoneTaken) throw new BadRequestException("رقم الهاتف مستخدم مسبقًا");

    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) throw new NotFoundException("الدور غير موجود");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        username,
        phone: dto.phone,
        passwordHash,
        type: "STAFF",
        staffRoleId: dto.roleId,
      },
      select: this.staffSelect(),
    });
    return user;
  }

  /** قائمة الموظفين */
  async listStaff(q: PaginationDto) {
    const where = {
      type: "STAFF" as const,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { username: { contains: q.search, mode: "insensitive" as const } },
              { phone: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: this.staffSelect(),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** تغيير دور موظف */
  async assignRole(userId: string, dto: AssignRoleDto) {
    const staff = await this.prisma.user.findFirst({
      where: { id: userId, type: "STAFF" },
    });
    if (!staff) throw new NotFoundException("الموظف غير موجود");
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) throw new NotFoundException("الدور غير موجود");
    return this.prisma.user.update({
      where: { id: userId },
      data: { staffRoleId: dto.roleId },
      select: this.staffSelect(),
    });
  }

  /** تغيير كلمة مرور موظف وإبطال رموز التحديث المفتوحة. */
  async updatePassword(userId: string, dto: UpdateStaffPasswordDto) {
    await this.ensureStaff(userId);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);

    return { ok: true };
  }

  /** تفعيل/تعليق/حظر موظف مع إبطال جلساته عند تعطيله. */
  async updateStatus(
    userId: string,
    dto: UpdateStaffStatusDto,
    actorId?: string,
  ) {
    await this.ensureStaff(userId);
    if (actorId === userId && dto.status !== "ACTIVE") {
      throw new BadRequestException("لا يمكنك تعطيل حسابك الحالي");
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
      select: this.staffSelect(),
    });

    if (dto.status !== "ACTIVE") {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        }),
        this.prisma.session.deleteMany({ where: { userId } }),
      ]);
    }

    return updated;
  }

  private async ensureStaff(userId: string) {
    const staff = await this.prisma.user.findFirst({
      where: { id: userId, type: "STAFF" },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException("الموظف غير موجود");
  }

  private staffSelect() {
    return {
      id: true,
      name: true,
      username: true,
      phone: true,
      type: true,
      status: true,
      createdAt: true,
      staffRole: {
        select: {
          id: true,
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    };
  }
}
