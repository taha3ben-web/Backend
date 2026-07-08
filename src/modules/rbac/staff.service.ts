import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AssignRoleDto, CreateStaffDto } from "./dto/rbac.dto";

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** إنشاء موظف (STAFF) وتعيين دور له */
  async createStaff(dto: CreateStaffDto) {
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

  private staffSelect() {
    return {
      id: true,
      name: true,
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
