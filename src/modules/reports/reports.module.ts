import { Module } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { ReportsService } from "./reports.service";
import { StatisticsController } from "./statistics.controller";
import { ReportsController } from "./reports.controller";

@Module({
  providers: [StatisticsService, ReportsService],
  controllers: [StatisticsController, ReportsController],
  exports: [StatisticsService, ReportsService],
})
export class ReportsModule {}
