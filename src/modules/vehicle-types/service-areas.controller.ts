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
import { ServiceAreasService } from "./service-areas.service";
import {
  CreateServiceAreaDto,
  UpdateServiceAreaDto,
} from "./dto/service-area.dto";

@Controller("service-areas")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("pricing.manage")
export class ServiceAreasController {
  constructor(private readonly areas: ServiceAreasService) {}

  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.areas.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.areas.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateServiceAreaDto, @CurrentUser() user: AuthUser) {
    return this.areas.create(dto, user?.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateServiceAreaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.areas.update(id, dto, user?.userId);
  }

  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.areas.setActive(id, isActive, user?.userId);
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.areas.restore(id, user?.userId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.areas.remove(id, user?.userId);
  }
}
