import { Module } from "@nestjs/common";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FareQuotesService } from "./fare-quotes.service";
import { FareOffersService } from "./fare-offers.service";
import { FareQuotesController } from "./fare-quotes.controller";
import { FareQuotesAdminController } from "./fare-quotes-admin.controller";
import { FareOffersDriverController } from "./fare-offers-driver.controller";
import { FareOffersAdminController } from "./fare-offers-admin.controller";

/**
 * وحدة عرض السعر التفاوضي (FareQuote — نموذج inDrive).
 * تستورد PricingEngineModule (لـ PricingEngineService) وتعتمد على PrismaService العام.
 */
@Module({
  imports: [PricingEngineModule, RealtimeModule, NotificationsModule],
  providers: [FareQuotesService, FareOffersService],
  controllers: [
    FareQuotesController,
    FareQuotesAdminController,
    FareOffersDriverController,
    FareOffersAdminController,
  ],
  exports: [FareQuotesService, FareOffersService],
})
export class FareQuotesModule {}
