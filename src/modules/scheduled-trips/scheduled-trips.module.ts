import { Module } from "@nestjs/common";
import { ScheduledTripsService } from "./scheduled-trips.service";
import { ScheduledTripsController } from "./scheduled-trips.controller";
import { CountryConfigModule } from "../country-config/country-config.module";

@Module({
  imports: [CountryConfigModule],
  providers: [ScheduledTripsService],
  controllers: [ScheduledTripsController],
  exports: [ScheduledTripsService],
})
export class ScheduledTripsModule {}
