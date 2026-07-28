import { Module } from "@nestjs/common";
import { FinancialService } from "./financial.service";
import { LedgerCoreService } from "./ledger-core.service";
import { FinancialController } from "./financial.controller";
import { CountryConfigModule } from "../country-config/country-config.module";

@Module({
  imports: [CountryConfigModule],
  controllers: [FinancialController],
  providers: [LedgerCoreService, FinancialService],
  exports: [FinancialService, LedgerCoreService],
})
export class FinancialModule {}
