import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { SettingsModule } from "../settings/settings.module";
import { TripCommunicationController } from "./trip-communication.controller";
import { TripCommunicationService } from "./trip-communication.service";

@Module({
  imports: [SettingsModule, forwardRef(() => RealtimeModule)],
  controllers: [TripCommunicationController],
  providers: [TripCommunicationService],
})
export class TripCommunicationModule {}
