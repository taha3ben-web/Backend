import { Module } from "@nestjs/common";
import { FinancialService } from "./financial.service";
import { FinancialController } from "./financial.controller";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { CountryConfigModule } from "../country-config/country-config.module";

@Module({
  imports: [PricingEngineModule, CountryConfigModule],
  controllers: [FinancialController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
