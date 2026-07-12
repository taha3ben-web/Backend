import { Controller, Get, UseGuards } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("reports.read", "drivers.read", "passengers.read", "trips.read")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  summary() {
    return this.dashboard.summary();
  }

  @Get("earnings")
  earnings() {
    return this.dashboard.earnings();
  }

  @Get("latest")
  latest() {
    return this.dashboard.latest();
  }

  @Get("live-map")
  liveMap() {
    return this.dashboard.liveMap();
  }
}
