import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingQuoteDto } from "./dto/pricing-quote.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

/**
 * واجهة اختبار محرك التسعير (STAFF): ترجع السعر والعمولة والقاعدة المستخدمة.
 * تفيد لوحة التحكم لمعاينة أثر قواعد التسعير قبل النشر.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("pricing-engine")
export class PricingEngineController {
  constructor(private readonly engine: PricingEngineService) {}

  @RequirePermissions("pricing.manage")
  @Post("quote")
  quote(@Body() dto: PricingQuoteDto) {
    return this.engine.quote(dto);
  }
}
