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
import { AppVersionsService } from "./app-versions.service";
import {
  CheckAppVersionDto,
  CreateAppVersionDto,
  UpdateAppVersionDto,
} from "./dto/app-versions.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@Controller("app-versions")
export class AppVersionsController {
  constructor(private readonly appVersions: AppVersionsService) {}

  @Get("check")
  check(@Query() dto: CheckAppVersionDto) {
    return this.appVersions.check(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Post()
  create(@Body() dto: CreateAppVersionDto) {
    return this.appVersions.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Get()
  findAll(
    @Query("platform") platform?: string,
    @Query("appId") appId?: string,
    @Query("releaseChannel") releaseChannel?: string,
  ) {
    return this.appVersions.findAll({ platform, appId, releaseChannel });
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAppVersionDto) {
    return this.appVersions.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.appVersions.remove(id);
  }
}
