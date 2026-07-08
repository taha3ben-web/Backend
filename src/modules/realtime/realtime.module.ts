import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RealtimeGateway } from "./realtime.gateway";
import { MatchingModule } from "../matching/matching.module";
import { TripsModule } from "../trips/trips.module";

@Module({
  imports: [
    JwtModule.register({}),
    forwardRef(() => MatchingModule),
    forwardRef(() => TripsModule),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
