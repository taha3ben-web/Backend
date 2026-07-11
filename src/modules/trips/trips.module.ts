import { Module, forwardRef } from "@nestjs/common";
import { TripsService } from "./trips.service";
import { TripsController } from "./trips.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { FinancialModule } from "../financial/financial.module";

@Module({
  imports: [forwardRef(() => RealtimeModule), FinancialModule],
  providers: [TripsService],
  controllers: [TripsController],
  exports: [TripsService],
})
export class TripsModule {}
