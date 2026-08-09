import { Module, forwardRef } from "@nestjs/common";
import { MatchingService } from "./matching.service";
import { PricingService } from "./pricing.service";
import { MatchingController } from "./matching.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { CouponsModule } from "../coupons/coupons.module";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { MatchingEngineModule } from "./engine/matching-engine.module";
import { CityScalingModule } from "../city-scaling/city-scaling.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    forwardRef(() => RealtimeModule),
    // RealtimeModule يستخدم forwardRef أصلاً للعودة إلى MatchingModule؛
    // المرور عبر NotificationsModule -> RealtimeModule يصل لنفس الحلقة،
    // فهذا الاستيراد يحتاج نفس المعاملة.
    forwardRef(() => NotificationsModule),
    CouponsModule,
    PricingEngineModule,
    MatchingEngineModule,
    CityScalingModule,
  ],
  providers: [MatchingService, PricingService],
  controllers: [MatchingController],
  exports: [MatchingService, PricingService],
})
export class MatchingModule {}
