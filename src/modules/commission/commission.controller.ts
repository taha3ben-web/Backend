import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CommissionService } from "./commission.service";
import {
  CreateCommissionRuleDto,
  EffectiveCommissionQueryDto,
  UpdateCommissionRuleDto,
} from "./dto/commission.dto";

/**
 * إدارة قواعد العمولة من لوحة التحكم.
 *
 * نفس نمط الحماية المستخدم في `/vehicle-pricing` (STAFF + صلاحية
 * `pricing.manage`) حتى لا يُضاف نموذج صلاحيات موازٍ: من يضبط السعر هو من
 * يضبط العمولة.
 */
@Controller("admin/commission-rules")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @RequirePermissions("pricing.manage")
  @Get()
  list(
    @Query() q: PaginationDto,
    @Query("countryCode") countryCode?: string,
    @Query("cityId") cityId?: string,
    @Query("vehicleTypeId") vehicleTypeId?: string,
    @Query("vehicleCategoryId") vehicleCategoryId?: string,
    @Query("isActive") isActive?: string,
  ) {
    return this.commission.list(q, {
      countryCode,
      cityId,
      vehicleTypeId,
      vehicleCategoryId,
      isActive:
        isActive === undefined ? undefined : isActive === "true",
    });
  }

  /**
   * «ما النسبة الفعّالة لهذا النطاق ولماذا؟» — يُرجع النسبة المحلولة،
   * القاعدة الفائزة، وكل القواعد المرشّحة. يمنع تخمين اللوحة للنتيجة.
   */
  @RequirePermissions("pricing.manage")
  @Get("effective")
  effective(@Query() q: EffectiveCommissionQueryDto) {
    return this.commission.effective(q);
  }

  @RequirePermissions("pricing.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.commission.findOne(id);
  }

  @RequirePermissions("pricing.manage")
  @Post()
  create(
    @Body() dto: CreateCommissionRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.commission.create(dto, user?.userId);
  }

  @RequirePermissions("pricing.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.commission.update(id, dto);
  }

  /** تعطيل (لا حذف) للحفاظ على أثر التدقيق على الرحلات السابقة. */
  @RequirePermissions("pricing.manage")
  @Delete(":id")
  deactivate(@Param("id") id: string) {
    return this.commission.deactivate(id);
  }
}
