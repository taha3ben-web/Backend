import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { ListQueryDto } from "../../common/dto/list-query.dto";
import { VehicleCategoriesService } from "./vehicle-categories.service";
import { WorkflowStatus } from "@prisma/client";
import {
  CreateVehicleCategoryDto,
  UpdateVehicleCategoryDto,
  ReorderDto,
  SetStatusDto,
} from "./dto/vehicle-category.dto";

@Controller("vehicle-categories")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class VehicleCategoriesController {
  constructor(private readonly categories: VehicleCategoriesService) {}

  @RequirePermissions("pricing.manage", "settings.manage")
  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.categories.findAll(query);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch("reorder")
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: AuthUser) {
    return this.categories.reorder(dto, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.categories.findOne(id);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Post()
  create(@Body() dto: CreateVehicleCategoryDto, @CurrentUser() user: AuthUser) {
    return this.categories.create(dto, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.update(id, dto, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.setActive(id, isActive, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch(":id/status")
  setStatus(
    @Param("id") id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.setStatus(
      id,
      dto.status as WorkflowStatus,
      user?.userId,
    );
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.categories.restore(id, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.categories.remove(id, user?.userId);
  }
}
