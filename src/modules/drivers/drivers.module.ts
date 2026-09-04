import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TripGuardsModule } from "../trips/trip-guards.module";
import { ProfileLevelsModule } from "../profile-levels/profile-levels.module";
// المرحلة و: لحقن RequirementsService المُصدَّر من وحدة الكتالوج.
// لا خطر استيراد دائري: VehicleTypesModule لا يستورد DriversModule.
import { VehicleTypesModule } from "../vehicle-types/vehicle-types.module";
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
// محرّك الصدارة: خدمة واحدة تقرأ القواعد من جدول Setting وترتّب في PostgreSQL.
// ConfigCacheService لا يحتاج استيرادًا: InfraModule مُعلن @Global.
// StorageService كذلك @Global. ProfileLevelsModule مستورد أصلًا أعلاه.
import { LeaderboardService } from "./leaderboard.service";
import { LeaderboardAdminController } from "./leaderboard-admin.controller";

@Module({
  imports: [
    RbacModule,
    NotificationsModule,
    TripGuardsModule,
    ProfileLevelsModule,
    VehicleTypesModule,
  ],
  providers: [
    DriversService,
    DriverSanctionsService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
    DriverQrService,
    LeaderboardService,
  ],
  controllers: [
    DriversController,
    VehiclesController,
    DocumentsController,
    DriverSelfController,
    DriverQrController,
    DriverQrPublicController,
    LeaderboardAdminController,
  ],
  exports: [
    DriversService,
    DriverSanctionsService,
    VehiclesService,
    DocumentsService,
    DriverSelfService,
    DriverQrService,
    LeaderboardService,
  ],
})
export class DriversModule {}
