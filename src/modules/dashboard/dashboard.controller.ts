import { Controller, Get, UseGuards } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
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
