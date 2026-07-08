import { Module } from "@nestjs/common";
import { PricingAdminService } from "./pricing-admin.service";
import { PricingAdminController } from "./pricing-admin.controller";

@Module({
  providers: [PricingAdminService],
  controllers: [PricingAdminController],
  exports: [PricingAdminService],
})
export class PricingAdminModule {}
