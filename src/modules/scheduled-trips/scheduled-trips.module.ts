import { Module } from "@nestjs/common";
import { ScheduledTripsService } from "./scheduled-trips.service";
import { ScheduledTripsController } from "./scheduled-trips.controller";
import { CountryConfigModule } from "../country-config/country-config.module";
import { CommissionModule } from "../commission/commission.module";

@Module({
  imports: [CountryConfigModule, CommissionModule],
  providers: [ScheduledTripsService],
  controllers: [ScheduledTripsController],
  exports: [ScheduledTripsService],
})
export class ScheduledTripsModule {}
