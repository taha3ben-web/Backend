import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { StaffService } from "./staff.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AssignRoleDto,
  CreateStaffDto,
  UpdateStaffPasswordDto,
  UpdateStaffProfileDto,
  UpdateStaffStatusDto,
} from "./dto/rbac.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("staff.manage")
@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@Query() q: PaginationDto) {
    return this.staff.listStaff(q);
  }

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staff.createStaff(dto);
  }

  @Patch(":id/role")
  assignRole(@Param("id") id: string, @Body() dto: AssignRoleDto) {
    return this.staff.assignRole(id, dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateStaffProfileDto) {
    return this.staff.updateStaff(id, dto);
  }

  @Patch(":id/password")
  updatePassword(
    @Param("id") id: string,
    @Body() dto: UpdateStaffPasswordDto,
  ) {
    return this.staff.updatePassword(id, dto);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateStaffStatusDto,
  ) {
    return this.staff.updateStatus(id, dto);
  }
}
