import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Put,
  UseGuards,
} from "@nestjs/common";
import { GeoAdminService } from "./geo-admin.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { AuditService } from "../rbac/audit.service";
import { UpdateGeoProviderConfigDto } from "./dto/geo.dto";

/**
 * لوحة التحكم: إدارة مزوّد الخرائط ومفاتيحه (STAFF + RBAC + Audit).
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
@Controller("admin/geo/provider")
export class GeoAdminController {
  constructor(
    private readonly geoAdmin: GeoAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  getConfig() {
    return this.geoAdmin.getConfig();
  }

  @Put()
  async updateConfig(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateGeoProviderConfigDto,
    @Ip() ip: string,
    @Headers("user-agent") userAgent: string,
  ) {
    const result = await this.geoAdmin.updateConfig(dto);
    await this.audit.record({
      actorId: user.userId,
      action: "geo.provider.update",
      entity: "MapsProviderConfig",
      entityId: "maps",
      ip,
      userAgent,
      meta: { changed: result.changed, provider: result.config.provider },
    });
    return result;
  }
}
