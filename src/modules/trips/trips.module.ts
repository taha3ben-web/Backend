import { Module, forwardRef } from "@nestjs/common";
import { TripsService } from "./trips.service";
import { TripsController } from "./trips.controller";
import { TripLifecycleDriverController } from "./trip-lifecycle-driver.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { FinancialModule } from "../financial/financial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [
    forwardRef(() => RealtimeModule),
    FinancialModule,
    NotificationsModule,
    SettingsModule,
  ],
  providers: [TripsService],
  controllers: [TripsController, TripLifecycleDriverController],
  exports: [TripsService],
})
export class TripsModule {}
