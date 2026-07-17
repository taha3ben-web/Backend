import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { GeofenceService } from "./geofence.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { GeoPointDto, GeoResolveDto } from "./dto/geo.dto";

/**
 * واجهات الاحتواء الجغرافي.
 * - serviceable: فحص خفيف متاح لأي مستخدم مصادَق (راكب/سائق).
 * - resolve: حسم كامل (أحياء + مناطق خدمة) محصور بالطاقم.
 */
@UseGuards(JwtAuthGuard)
@Controller("geofence")
export class GeofenceController {
  constructor(private readonly geofence: GeofenceService) {}

  @Get("serviceable")
  serviceable(@Query() q: GeoPointDto) {
    return this.geofence.checkServiceable(q.lat, q.lng);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage", "pricing.manage")
  @Get("resolve")
  resolve(@Query() q: GeoResolveDto) {
    return this.geofence.resolvePoint(q.lat, q.lng, q.cityId);
  }
}
