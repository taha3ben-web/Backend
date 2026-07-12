import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CatalogService } from "./catalog.service";
import { CatalogAnalyticsService } from "./catalog-analytics.service";
import { AuditService } from "./audit.service";

type Audience = "passenger" | "driver" | "all";

/**
 * نقطة عامة (للراكب والسائق): ترجع الفئات والأنواع المنشورة مع التسعير.
 */
@Controller("catalog")
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly analytics: CatalogAnalyticsService,
    private readonly audit: AuditService,
  ) {}

  @Get("vehicles")
  @UseGuards(JwtAuthGuard)
  vehicles(
    @Query("usageType") usageType?: string,
    @Query("audience") audience?: Audience,
  ) {
    return this.catalog.publicCatalog(usageType, audience ?? "passenger");
  }

  /** رقم نسخة الكتالوج (لـ smart cache في التطبيقات). */
  @Get("version")
  @UseGuards(JwtAuthGuard)
  version() {
    return this.catalog.version();
  }

  /** إحصائيات الكتالوج للوحة (STAFF فقط). */
  @Get("analytics")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("pricing.manage", "reports.read")
  analyticsOverview() {
    return this.analytics.overview();
  }

  /**
   * سجل التعديلات (Audit Log) للوحة (STAFF فقط).
   * مثال: /api/catalog/audit?entity=VehicleType&entityId=<id>&page=1&limit=20
   */
  @Get("audit")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("pricing.manage", "audit.read")
  auditLog(
    @Query("entity") entity?: string,
    @Query("entityId") entityId?: string,
    @Query("action") action?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.audit.query({
      entity,
      entityId,
      action,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
