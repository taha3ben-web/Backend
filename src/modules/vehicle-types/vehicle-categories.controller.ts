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
import { Roles } from "../../common/decorators/roles.decorator";
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class VehicleCategoriesController {
  constructor(private readonly categories: VehicleCategoriesService) {}

  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.categories.findAll(query);
  }

  @Patch("reorder")
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: AuthUser) {
    return this.categories.reorder(dto, user?.userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateVehicleCategoryDto, @CurrentUser() user: AuthUser) {
    return this.categories.create(dto, user?.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.update(id, dto, user?.userId);
  }

  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categories.setActive(id, isActive, user?.userId);
  }

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

  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.categories.restore(id, user?.userId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.categories.remove(id, user?.userId);
  }
}
