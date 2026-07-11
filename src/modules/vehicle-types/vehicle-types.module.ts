import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { VehicleTypesService } from "./vehicle-types.service";
import { VehicleTypesController } from "./vehicle-types.controller";
import { VehicleCategoriesService } from "./vehicle-categories.service";
import { VehicleCategoriesController } from "./vehicle-categories.controller";
import { VehiclePricingService } from "./vehicle-pricing.service";
import { VehiclePricingController } from "./vehicle-pricing.controller";
import { ServiceAreasService } from "./service-areas.service";
import { ServiceAreasController } from "./service-areas.controller";
import { FeaturesService } from "./features.service";
import { FeaturesController } from "./features.controller";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { CatalogSeedService } from "./catalog-seed.service";
import { VehicleFieldsService } from "./vehicle-fields.service";
import { RequirementsService } from "./requirements.service";
import { CatalogAnalyticsService } from "./catalog-analytics.service";

/**
 * وحدة كتالوج المركبات الديناميكي (Enterprise): فئات + أنواع (كخدمة كاملة)
 * + قواعد تسعير مرنة + مناطق خدمة (مستقلة عن مزوّد الخرائط)
 * + ميزات مرنة + حقول ديناميكية + تحقق من المتطلبات + تحليلات
 * + تدقيق + كتالوج عام + بذر لمرة واحدة. يعتمد على InfraModule (أحداث + Cache) العامة.
 */
@Module({
  providers: [
    AuditService,
    VehicleTypesService,
    VehicleCategoriesService,
    VehiclePricingService,
    ServiceAreasService,
    FeaturesService,
    CatalogService,
    CatalogSeedService,
    VehicleFieldsService,
    RequirementsService,
    CatalogAnalyticsService,
  ],
  controllers: [
    VehicleTypesController,
    VehicleCategoriesController,
    VehiclePricingController,
    ServiceAreasController,
    FeaturesController,
    CatalogController,
  ],
  exports: [
    VehicleTypesService,
    VehicleCategoriesService,
    VehiclePricingService,
    ServiceAreasService,
    FeaturesService,
    CatalogService,
    VehicleFieldsService,
    RequirementsService,
    CatalogAnalyticsService,
  ],
})
export class VehicleTypesModule {}
