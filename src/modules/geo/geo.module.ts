import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SettingsModule } from "../settings/settings.module";
import { RbacModule } from "../rbac/rbac.module";
import { GeoService } from "./geo.service";
import { GeoProviderService } from "./geo-provider.service";
import { GeoAdminService } from "./geo-admin.service";
import { GeofenceService } from "./geofence.service";
import { SavedPlacesService } from "./saved-places.service";
import { InternalGeoProvider } from "./providers/internal-geo.provider";
import { GoogleGeoProvider } from "./providers/google-geo.provider";
import { GeoController } from "./geo.controller";
import { SavedPlacesController } from "./saved-places.controller";
import { GeoAdminController } from "./geo-admin.controller";
import { GeofenceController } from "./geofence.controller";

/**
 * وحدة Geo/Places (Stage 50):
 * - تجريد مزوّد الخرائط (داخلي offline افتراضيًا + Google قابل للتفعيل).
 * - واجهات تطبيق: autocomplete/geocode/reverse/directions.
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
    InternalGeoProvider,
    GoogleGeoProvider,
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
    SavedPlacesService,
    GeofenceService,
  ],
})
export class GeoModule {}
