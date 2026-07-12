import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AppVersionsService } from "./app-versions.service";
import { CreateAppVersionDto } from "./dto/app-versions.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@Controller("app-versions")
export class AppVersionsController {
  constructor(private readonly appVersions: AppVersionsService) {}

  /**
   * فحص التحديث (عام — يُستدعى عند إقلاع التطبيق).
   * مثال: GET /api/app-versions/check?platform=android&version=1.0.0
   */
  @Get("check")
  check(
    @Query("platform") platform: string,
    @Query("version") version: string,
  ) {
    return this.appVersions.check(platform, version ?? "0.0.0");
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("settings.manage")
  @Post()
  create(@Body() dto: CreateAppVersionDto) {
    return this.appVersions.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("settings.manage")
  @Get()
  findAll(@Query("platform") platform?: string) {
    return this.appVersions.findAll(platform);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("settings.manage")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.appVersions.remove(id);
  }
}
