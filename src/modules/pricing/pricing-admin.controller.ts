import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { PricingAdminService } from "./pricing-admin.service";
import {
  CreatePeakPricingDto,
  CreatePricingRuleDto,
  UpdatePricingFeesDto,
  UpdatePricingRuleDto,
} from "./dto/pricing.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("pricing")
export class PricingAdminController {
  constructor(private readonly pricing: PricingAdminService) {}

  // ---------- رسوم الأجرة المركزية (المرحلة 7) ----------

  /**
   * رسوم الخدمة والانتظار والإلغاء — مصدرها الوحيد اللوحة،
   * وتستهلكها دوال الأجرة القائمة في fare-breakdown.util.ts.
   */
  @RequirePermissions("pricing.manage")
  @Get("fees")
  getFees() {
    return this.pricing.getFees();
  }

  @RequirePermissions("pricing.manage")
  @Patch("fees")
  updateFees(@Body() dto: UpdatePricingFeesDto) {
    return this.pricing.updateFees(dto);
  }

  // ---------- قواعد التسعير ----------

  @RequirePermissions("pricing.manage")
  @Get("rules")
  listRules() {
    return this.pricing.listRules();
  }

  @RequirePermissions("pricing.manage")
  @Post("rules")
  createRule(@Body() dto: CreatePricingRuleDto) {
    return this.pricing.createRule(dto);
  }

  @RequirePermissions("pricing.manage")
  @Patch("rules/:id")
  updateRule(@Param("id") id: string, @Body() dto: UpdatePricingRuleDto) {
    return this.pricing.updateRule(id, dto);
  }

  @RequirePermissions("pricing.manage")
  @Delete("rules/:id")
  deleteRule(@Param("id") id: string) {
    return this.pricing.deleteRule(id);
  }

  // ---------- تسعير الذروة ----------

  @RequirePermissions("pricing.manage")
  @Post("peak")
  createPeak(@Body() dto: CreatePeakPricingDto) {
    return this.pricing.createPeak(dto);
  }

  @RequirePermissions("pricing.manage")
  @Delete("peak/:id")
  deletePeak(@Param("id") id: string) {
    return this.pricing.deletePeak(id);
  }
}
