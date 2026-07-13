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
import { VehiclePricingService } from "./vehicle-pricing.service";
import {
  CreateVehiclePricingRuleDto,
  UpdateVehiclePricingRuleDto,
} from "./dto/vehicle-pricing.dto";

@Controller("vehicle-pricing")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class VehiclePricingController {
  constructor(private readonly pricing: VehiclePricingService) {}

  @RequirePermissions("pricing.manage")
  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.pricing.findAll(query);
  }

  @RequirePermissions("pricing.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.pricing.findOne(id);
  }

  @RequirePermissions("pricing.manage")
  @Post()
  create(
    @Body() dto: CreateVehiclePricingRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pricing.create(dto, user?.userId);
  }

  @RequirePermissions("pricing.manage")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVehiclePricingRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pricing.update(id, dto, user?.userId);
  }

  @RequirePermissions("pricing.manage")
  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.pricing.restore(id, user?.userId);
  }

  @RequirePermissions("pricing.manage")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.pricing.remove(id, user?.userId);
  }
}
