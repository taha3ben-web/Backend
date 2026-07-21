import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { TripCommunicationController } from "./trip-communication.controller";
import { TripCommunicationService } from "./trip-communication.service";

@Module({
  imports: [SettingsModule],
  controllers: [TripCommunicationController],
  providers: [TripCommunicationService],
})
export class TripCommunicationModule {}
