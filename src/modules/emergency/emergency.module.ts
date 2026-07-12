import { Module } from "@nestjs/common";
import { EmergencyService } from "./emergency.service";
import { EmergencyController } from "./emergency.controller";
import { SafetyController } from "./safety.controller";
import { SafetyService } from "./safety.service";

@Module({
  providers: [EmergencyService, SafetyService],
  controllers: [EmergencyController, SafetyController],
  exports: [EmergencyService, SafetyService],
})
export class EmergencyModule {}
