import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { FareOffersService } from "./fare-offers.service";
import { AdminFareOfferQueryDto } from "./dto/fare-offer.dto";

/**
 * واجهة اللوحة لعروض السائقين (STAFF + pricing.manage): معاينة/تدقيق فقط.
 */
@Controller("admin/fare-offers")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("pricing.manage")
export class FareOffersAdminController {
  constructor(private readonly service: FareOffersService) {}

  @Get()
  list(@Query() query: AdminFareOfferQueryDto) {
    return this.service.adminList(query);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.service.adminGet(id);
  }
}
