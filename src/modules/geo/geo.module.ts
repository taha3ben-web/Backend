import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SettingsModule } from "../settings/settings.module";
import { RbacModule } from "../rbac/rbac.module";
import { GeoService } from "./geo.service";
import { GeoProviderService } from "./geo-provider.service";
import { GeoAdminService } from "./geo-admin.service";
import { GeofenceService } from "./geofence.service";
import { SavedPlacesService } from "./saved-places.service";
import { RoutingService } from "./routing.service";
import { InternalGeoProvider } from "./providers/internal-geo.provider";
import { GoogleGeoProvider } from "./providers/google-geo.provider";
import { OsrmGeoProvider } from "./providers/osrm-geo.provider";
import { GeoController } from "./geo.controller";
import { SavedPlacesController } from "./saved-places.controller";
import { GeoAdminController } from "./geo-admin.controller";
import { GeofenceController } from "./geofence.controller";

/**
 * وحدة Geo/Places:
 * - تجريد مزوّد الخرائط (داخلي offline افتراضيًا + OSRM + Google قابلان للتفعيل).
 * - واجهات تطبيق: autocomplete/geocode/reverse/directions.
 * - `RoutingService`: المصدر الوحيد للمسافة والمدة الحقيقية (تستخدمه التسعيرة والمطابقة).
 * - أماكن محفوظة (Home/Work/Recent/Other) كمصدر حقيقة في الباكند.
 * - لوحة تحكم STAFF لإدارة المزوّد والمفاتيح (RBAC + Audit).
 */
@Module({
  imports: [PrismaModule, SettingsModule, RbacModule],
  providers: [
    GeoService,
    GeoProviderService,
    GeoAdminService,
    GeofenceService,
    SavedPlacesService,
    RoutingService,
    InternalGeoProvider,
    GoogleGeoProvider,
    OsrmGeoProvider,
  ],
  controllers: [
    GeoController,
    SavedPlacesController,
    GeoAdminController,
    GeofenceController,
  ],
  exports: [
    GeoService,
    GeoProviderService,
    RoutingService,
    SavedPlacesService,
    GeofenceService,
  ],
})
export class GeoModule {}
