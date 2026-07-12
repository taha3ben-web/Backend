import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AssignRoleDto,
  CreateStaffDto,
  UpdateStaffPasswordDto,
  UpdateStaffProfileDto,
  UpdateStaffStatusDto,
} from "./dto/rbac.dto";

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** إنشاء موظف (STAFF) وتعيين دور له */
  async createStaff(dto: CreateStaffDto) {
    const normalized = this.normalizeProfile(dto);
    await this.ensureIdentifiersAvailable(normalized);

    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) throw new NotFoundException("الدور غير موجود");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: normalized.name!,
        username: normalized.username!,
        phone: normalized.phone!,
        email: normalized.email,
        passwordHash,
        type: "STAFF",
        staffRoleId: dto.roleId,
        status: dto.status ?? UserStatus.ACTIVE,
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
              { email: { contains: q.search, mode: "insensitive" as const } },
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

  async updateStaff(userId: string, dto: UpdateStaffProfileDto) {
    await this.getStaffOrThrow(userId);

    const normalized = this.normalizeProfile(dto);
    await this.ensureIdentifiersAvailable(normalized, userId);

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: normalized.name,
          username: normalized.username,
          phone: normalized.phone,
          email: normalized.email,
        },
        select: this.staffSelect(),
      });
    } catch (error) {
      this.rethrowUniqueError(error);
      throw error;
    }
  }

  async updatePassword(userId: string, dto: UpdateStaffPasswordDto) {
    await this.getStaffOrThrow(userId);
    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, lastUsedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "STAFF_PASSWORD_CHANGED" },
      }),
    ]);

    return { ok: true };
  }

  async updateStatus(userId: string, dto: UpdateStaffStatusDto) {
    await this.getStaffOrThrow(userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: dto.status },
      select: this.staffSelect(),
    });

    if (dto.status !== UserStatus.ACTIVE) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true, lastUsedAt: new Date() },
        }),
        this.prisma.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: `STAFF_STATUS_${dto.status}` },
        }),
      ]);
    }

    return updated;
  }

  private async getStaffOrThrow(userId: string) {
    const staff = await this.prisma.user.findFirst({
      where: { id: userId, type: "STAFF" },
    });
    if (!staff) throw new NotFoundException("الموظف غير موجود");
    return staff;
  }

  private normalizeProfile(
    dto: Partial<CreateStaffDto & UpdateStaffProfileDto>,
  ): {
    name?: string;
    username?: string;
    phone?: string;
    email?: string | null;
  } {
    const name = dto.name?.trim();
    const username = dto.username?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    const emailValue = dto.email?.trim().toLowerCase();
    const email = emailValue === "" ? null : emailValue;

    if (username !== undefined && !/^[a-z0-9._-]+$/.test(username)) {
      throw new BadRequestException(
        "اسم الدخول يجب أن يحتوي على أحرف إنجليزية أو أرقام أو . أو _ أو - فقط",
      );
    }

    return { name, username, phone, email };
  }

  private async ensureIdentifiersAvailable(
    identifiers: {
      username?: string;
      phone?: string;
      email?: string | null;
    },
    excludeUserId?: string,
  ) {
    const checks: Array<{ field: "username" | "phone" | "email"; value: string }> = [];
    if (identifiers.username) checks.push({ field: "username", value: identifiers.username });
    if (identifiers.phone) checks.push({ field: "phone", value: identifiers.phone });
    if (identifiers.email) checks.push({ field: "email", value: identifiers.email });

    for (const check of checks) {
      const existing = await this.prisma.user.findFirst({
        where: {
          [check.field]: check.value,
          ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
        },
        select: { id: true },
      });
      if (!existing) continue;

      if (check.field === "username") {
        throw new BadRequestException("اسم الدخول مستخدم مسبقًا");
      }
      if (check.field === "phone") {
        throw new BadRequestException("رقم الهاتف مستخدم مسبقًا");
      }
      throw new BadRequestException("البريد الإلكتروني مستخدم مسبقًا");
    }
  }

  private rethrowUniqueError(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BadRequestException("يوجد تعارض في اسم الدخول أو الهاتف أو البريد الإلكتروني");
    }
  }

  private staffSelect() {
    return {
      id: true,
      name: true,
      username: true,
      phone: true,
      email: true,
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
