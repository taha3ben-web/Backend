import { Module } from "@nestjs/common";
import { EmergencyService } from "./emergency.service";
import { EmergencyController } from "./emergency.controller";

@Module({
  providers: [EmergencyService],
  controllers: [EmergencyController],
  exports: [EmergencyService],
})
export class EmergencyModule {}
