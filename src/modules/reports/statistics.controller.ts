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
@RequirePermissions("reports.read")
@Controller("statistics")
export class StatisticsController {
  constructor(private readonly stats: StatisticsService) {}

  @Get("overview")
  overview(@Query() range: DateRangeDto) {
    return this.stats.overview(range);
  }

  @Get("revenue")
  revenue(@Query() range: DateRangeDto) {
    return this.stats.revenue(range);
  }

  @Get("payment-ops")
  paymentOps(@Query() range: DateRangeDto) {
    return this.stats.paymentOps(range);
  }

  @Get("settlement-ops")
  settlementOps(@Query() range: DateRangeDto) {
    return this.stats.settlementOps(range);
  }

  @Get("withdrawal-ops")
  withdrawalOps(@Query() range: DateRangeDto) {
    return this.stats.withdrawalOps(range);
  }

  @Get("funding-ops")
  fundingOps(@Query() range: DateRangeDto) {
    return this.stats.fundingOps(range);
  }

  @Get("transfer-ops")
  transferOps(@Query() range: DateRangeDto) {
    return this.stats.transferOps(range);
  }

  @Get("financial-health")
  financialHealth(@Query() range: DateRangeDto) {
    return this.stats.financialHealth(range);
  }

  @Get("timeseries")
  timeseries(@Query() range: DateRangeDto) {
    return this.stats.timeseries(range);
  }

  @Get("top-drivers")
  topDrivers(@Query() range: DateRangeDto) {
    return this.stats.topDrivers(range, 10);
  }

  @Get("top-cities")
  topCities(@Query() range: DateRangeDto) {
    return this.stats.topCities(range, 10);
  }
}
