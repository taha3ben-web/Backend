import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { PoolingService } from "./pooling.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

/**
 * واجهة معاينة أساس المشاركة (STAFF): ترجع الرحلات المرشحة للمشاركة
 * مع رحلة معينة (القرب والانحراف وفارق الاتجاه). قراءة فقط — لا تغيّر أي تدفق.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("pooling")
export class PoolingController {
  constructor(private readonly pooling: PoolingService) {}

  @RequirePermissions("trips.read", "trips.manage")
  @Get("candidates/:tripId")
  candidates(@Param("tripId") tripId: string) {
    return this.pooling.findCandidates(tripId);
  }
}
