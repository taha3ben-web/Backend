import { Module } from "@nestjs/common";
import { PromoCodesService } from "./promo-codes.service";
import { PromoCodesController } from "./promo-codes.controller";
import { FinancialModule } from "../financial/financial.module";

@Module({
  imports: [FinancialModule],
  providers: [PromoCodesService],
  controllers: [PromoCodesController],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
