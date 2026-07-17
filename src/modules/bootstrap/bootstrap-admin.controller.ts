import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapPreviewDto } from "./dto/bootstrap.dto";

/**
 * معاينة حمولة التهيئة من اللوحة (STAFF): تسمح للموظف بمعاينة
 * ما سيستلمه التطبيق لسياق محدّد (منصة/إصدار/مدينة/دور/شرائح) — قراءة فقط.
 */
@Controller("admin/bootstrap")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class BootstrapAdminController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get("preview")
  preview(@Query() query: BootstrapPreviewDto) {
    const { subjectId, role, ...ctx } = query;
    return this.bootstrap.preview({ subjectId, role, ctx });
  }
}
