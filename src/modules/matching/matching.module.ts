import { Module, forwardRef } from "@nestjs/common";
import { MatchingService } from "./matching.service";
import { PricingService } from "./pricing.service";
import { MatchingController } from "./matching.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { CouponsModule } from "../coupons/coupons.module";

@Module({
  imports: [forwardRef(() => RealtimeModule), CouponsModule],
  providers: [MatchingService, PricingService],
  controllers: [MatchingController],
  exports: [MatchingService, PricingService],
})
export class MatchingModule {}
