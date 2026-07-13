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
import { FeaturesService } from "./features.service";
import { CreateFeatureDto, UpdateFeatureDto } from "./dto/feature.dto";

@Controller("features")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @RequirePermissions("pricing.manage", "settings.manage")
  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.features.findAll(query);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.features.findOne(id);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Post()
  create(@Body() dto: CreateFeatureDto, @CurrentUser() user: AuthUser) {
    return this.features.create(dto, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.features.update(id, dto, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.features.setActive(id, isActive, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.features.restore(id, user?.userId);
  }

  @RequirePermissions("pricing.manage", "settings.manage")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.features.remove(id, user?.userId);
  }
}
