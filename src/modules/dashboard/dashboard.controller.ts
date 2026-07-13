import { Controller, Get, UseGuards } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  @RequirePermissions("reports.read", "drivers.read", "trips.read")
  summary() {
    return this.dashboard.summary();
  }

  @Get("earnings")
  @RequirePermissions("reports.read", "payments.read")
  earnings() {
    return this.dashboard.earnings();
  }

  @Get("latest")
  @RequirePermissions("reports.read", "trips.read", "support.manage")
  latest() {
    return this.dashboard.latest();
  }

  @Get("live-map")
  @RequirePermissions("reports.read", "drivers.read")
  liveMap() {
    return this.dashboard.liveMap();
  }

  @Get("operations")
  @RequirePermissions("reports.read", "support.manage", "safety.manage")
  operations() {
    return this.dashboard.operations();
  }
}
