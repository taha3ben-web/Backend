import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { DateRangeDto } from "./dto/reports.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
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
