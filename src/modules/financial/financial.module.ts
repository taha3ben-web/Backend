import { Module } from "@nestjs/common";
import { FinancialService } from "./financial.service";
import { FinancialController } from "./financial.controller";
import { CountryConfigModule } from "../country-config/country-config.module";

@Module({
  imports: [CountryConfigModule],
  controllers: [FinancialController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
