import { Module } from "@nestjs/common";
import { VehicleTypesService } from "./vehicle-types.service";
import { VehicleTypesController } from "./vehicle-types.controller";

/** وحدة أنواع المركبات (CRUD كامل من لوحة التحكم). */
@Module({
  providers: [VehicleTypesService],
  controllers: [VehicleTypesController],
  exports: [VehicleTypesService],
})
export class VehicleTypesModule {}
