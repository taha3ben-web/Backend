import { Module } from "@nestjs/common";
import { DriversService } from "./drivers.service";
import { DriversController } from "./drivers.controller";
import { VehiclesService } from "./vehicles.service";
import { VehiclesController } from "./vehicles.controller";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { DriverSelfService } from "./driver-self.service";
import { DriverSelfController } from "./driver-self.controller";

@Module({
  providers: [
    DriversService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
  ],
  controllers: [
    DriversController,
    VehiclesController,
    DocumentsController,
    DriverSelfController,
  ],
  exports: [DriversService, VehiclesService, DocumentsService, DriverSelfService],
})
export class DriversModule {}
