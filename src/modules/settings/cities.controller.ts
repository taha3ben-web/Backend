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
import { CitiesService } from "./cities.service";
import { CreateCityDto, UpdateCityDto } from "./dto/settings.dto";

@Controller("cities")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  @RequirePermissions("settings.manage")
  findAll(@Query("activeOnly") activeOnly?: string) {
    return this.cities.findAll(activeOnly !== "true");
  }

  @Get(":id")
  @RequirePermissions("settings.manage")
  findOne(@Param("id") id: string) {
    return this.cities.findOne(id);
  }

  @Post()
  @RequirePermissions("settings.manage")
  create(@Body() dto: CreateCityDto) {
    return this.cities.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("settings.manage")
  update(@Param("id") id: string, @Body() dto: UpdateCityDto) {
    return this.cities.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("settings.manage")
  remove(@Param("id") id: string) {
    return this.cities.remove(id);
  }
}
