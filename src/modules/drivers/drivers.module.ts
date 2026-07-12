import { Module } from "@nestjs/common";
import { DriversService } from "./drivers.service";
import { DriversController } from "./drivers.controller";
import { VehiclesService } from "./vehicles.service";
import { VehiclesController } from "./vehicles.controller";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { DriverSelfService } from "./driver-self.service";
import { DriverSelfController } from "./driver-self.controller";
import { DriverQrService } from "./driver-qr.service";
import { DriverQrController } from "./driver-qr.controller";
import { DriverQrPublicController } from "./driver-qr-public.controller";

@Module({
  providers: [
    DriversService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
    DriverQrService,
  ],
  controllers: [
    DriversController,
    VehiclesController,
    DocumentsController,
    DriverSelfController,
    DriverQrController,
    DriverQrPublicController,
  ],
  exports: [
    DriversService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
    DriverQrService,
  ],
})
export class DriversModule {}
