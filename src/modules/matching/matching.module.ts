import { Module, forwardRef } from "@nestjs/common";
import { MatchingService } from "./matching.service";
import { PricingService } from "./pricing.service";
import { MatchingController } from "./matching.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { CouponsModule } from "../coupons/coupons.module";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { MatchingEngineModule } from "./engine/matching-engine.module";

@Module({
  imports: [
    forwardRef(() => RealtimeModule),
    CouponsModule,
    PricingEngineModule,
    MatchingEngineModule,
  ],
  providers: [MatchingService, PricingService],
  controllers: [MatchingController],
  exports: [MatchingService, PricingService],
})
export class MatchingModule {}
