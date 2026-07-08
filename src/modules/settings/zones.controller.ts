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
import { ZonesService } from "./zones.service";
import { CreateZoneDto, UpdateZoneDto } from "./dto/settings.dto";

@Controller("zones")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequirePermissions("settings.manage")
  findByCity(@Query("cityId") cityId: string) {
    return this.zones.findByCity(cityId);
  }

  @Get(":id")
  @RequirePermissions("settings.manage")
  findOne(@Param("id") id: string) {
    return this.zones.findOne(id);
  }

  @Post()
  @RequirePermissions("settings.manage")
  create(@Body() dto: CreateZoneDto) {
    return this.zones.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("settings.manage")
  update(@Param("id") id: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("settings.manage")
  remove(@Param("id") id: string) {
    return this.zones.remove(id);
  }
}
