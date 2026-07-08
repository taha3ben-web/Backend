import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { RolesService } from "./roles.service";
import {
  CreatePermissionDto,
  CreateRoleDto,
  SetRolePermissionsDto,
  UpdateRoleDto,
} from "./dto/rbac.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("staff.manage")
@Controller("rbac")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // ---------- الأدوار ----------

  @Get("roles")
  listRoles() {
    return this.roles.listRoles();
  }

  @Get("roles/:id")
  getRole(@Param("id") id: string) {
    return this.roles.getRole(id);
  }

  @Post("roles")
  createRole(@Body() dto: CreateRoleDto) {
    return this.roles.createRole(dto);
  }

  @Patch("roles/:id")
  updateRole(@Param("id") id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.updateRole(id, dto);
  }

  @Put("roles/:id/permissions")
  setPermissions(@Param("id") id: string, @Body() dto: SetRolePermissionsDto) {
    return this.roles.setRolePermissions(id, dto);
  }

  @Delete("roles/:id")
  deleteRole(@Param("id") id: string) {
    return this.roles.deleteRole(id);
  }

  // ---------- الصلاحيات ----------

  @Get("permissions")
  listPermissions() {
    return this.roles.listPermissions();
  }

  @Post("permissions")
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.roles.createPermission(dto);
  }
}
