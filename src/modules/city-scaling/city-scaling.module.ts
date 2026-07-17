import { Module } from "@nestjs/common";
import { CityScalingService } from "./city-scaling.service";
import { CityScalingController } from "./city-scaling.controller";

@Module({
  providers: [CityScalingService],
  controllers: [CityScalingController],
  exports: [CityScalingService],
})
export class CityScalingModule {}
