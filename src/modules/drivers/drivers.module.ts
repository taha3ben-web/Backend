import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TripGuardsModule } from "../trips/trip-guards.module";
import { ProfileLevelsModule } from "../profile-levels/profile-levels.module";
import { DriversService } from "./drivers.service";
import { DriverSanctionsService } from "./driver-sanctions.service";
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
  imports: [
    RbacModule,
    NotificationsModule,
    TripGuardsModule,
    ProfileLevelsModule,
  ],
  providers: [
    DriversService,
    DriverSanctionsService,
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
    DriverSanctionsService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
    DriverQrService,
  ],
})
export class DriversModule {}
