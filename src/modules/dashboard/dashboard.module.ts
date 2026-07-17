import { Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";
import { OpsCenterService } from "./ops-center.service";
import { OpsCenterController } from "./ops-center.controller";
import { FinancialModule } from "../financial/financial.module";
import { RiskModule } from "../risk/risk.module";

@Module({
  imports: [FinancialModule, RiskModule],
  providers: [DashboardService, OpsCenterService],
  controllers: [DashboardController, OpsCenterController],
})
export class DashboardModule {}
