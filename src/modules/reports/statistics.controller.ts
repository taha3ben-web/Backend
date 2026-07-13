import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { DateRangeDto } from "./dto/reports.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("statistics")
export class StatisticsController {
  constructor(private readonly stats: StatisticsService) {}

  @RequirePermissions("reports.read")
  @Get("overview")
  overview(@Query() range: DateRangeDto) {
    return this.stats.overview(range);
  }

  @RequirePermissions("reports.read")
  @Get("revenue")
  revenue(@Query() range: DateRangeDto) {
    return this.stats.revenue(range);
  }

  @RequirePermissions("reports.read", "payments.read")
  @Get("payment-ops")
  paymentOps(@Query() range: DateRangeDto) {
    return this.stats.paymentOps(range);
  }

  @RequirePermissions("reports.read", "payments.read")
  @Get("settlement-ops")
  settlementOps(@Query() range: DateRangeDto) {
    return this.stats.settlementOps(range);
  }

  @RequirePermissions("reports.read", "payments.read")
  @Get("withdrawal-ops")
  withdrawalOps(@Query() range: DateRangeDto) {
    return this.stats.withdrawalOps(range);
  }

  @RequirePermissions("reports.read", "funding.read")
  @Get("funding-ops")
  fundingOps(@Query() range: DateRangeDto) {
    return this.stats.fundingOps(range);
  }

  @RequirePermissions("reports.read", "transfer.read")
  @Get("transfer-ops")
  transferOps(@Query() range: DateRangeDto) {
    return this.stats.transferOps(range);
  }

  @RequirePermissions("reports.read", "payments.read")
  @Get("financial-health")
  financialHealth(@Query() range: DateRangeDto) {
    return this.stats.financialHealth(range);
  }

  @RequirePermissions("reports.read")
  @Get("timeseries")
  timeseries(@Query() range: DateRangeDto) {
    return this.stats.timeseries(range);
  }

  @RequirePermissions("reports.read")
  @Get("top-drivers")
  topDrivers(@Query() range: DateRangeDto) {
    return this.stats.topDrivers(range, 10);
  }

  @RequirePermissions("reports.read")
  @Get("top-cities")
  topCities(@Query() range: DateRangeDto) {
    return this.stats.topCities(range, 10);
  }
}
