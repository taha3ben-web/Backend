import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreatePermissionDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from "./dto/rbac.dto";

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- الأدوار ----------

  async createRole(dto: CreateRoleDto) {
    const exists = await this.prisma.role.findUnique({
      where: { name: dto.name },
    });
    if (exists) throw new BadRequestException("اسم الدور موجود مسبقًا");

    const permissionIds = await this.resolvePermissionIds(
      dto.permissionKeys ?? [],
    );
    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: this.roleInclude(),
    });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: "asc" },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  }

  async getRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: this.roleInclude(),
    });
    if (!role) throw new NotFoundException("الدور غير موجود");
    return role;
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.getRole(id);
    if (dto.permissionKeys) {
      await this.replacePermissions(id, dto.permissionKeys);
    }
    return this.prisma.role.update({
      where: { id },
      data: { description: dto.description },
      include: this.roleInclude(),
    });
  }

  async setRolePermissions(id: string, dto: SetRolePermissionsDto) {
    await this.getRole(id);
    await this.replacePermissions(id, dto.permissionKeys);
    return this.getRole(id);
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException("الدور غير موجود");
    if (role._count.users > 0) {
      throw new BadRequestException("لا يمكن حذف دور مرتبط بموظفين");
    }
    await this.prisma.role.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- الصلاحيات ----------

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { key: "asc" } });
  }

  async createPermission(dto: CreatePermissionDto) {
    const exists = await this.prisma.permission.findUnique({
      where: { key: dto.key },
    });
    if (exists) throw new BadRequestException("الصلاحية موجودة مسبقًا");
    return this.prisma.permission.create({
      data: { key: dto.key, description: dto.description },
    });
  }

  // ---------- أدوات مساعدة ----------

  private roleInclude() {
    return { permissions: { include: { permission: true } } };
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const found = new Set(permissions.map((p) => p.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `صلاحيات غير موجودة: ${missing.join(", ")}`,
      );
    }
    return permissions.map((p) => p.id);
  }

  private async replacePermissions(
    roleId: string,
    keys: string[],
  ): Promise<void> {
    const permissionIds = await this.resolvePermissionIds(keys);
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
          skipDuplicates: true,
        });
      }
    });
  }
}
