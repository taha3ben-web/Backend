import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { FareQuotesService } from "./fare-quotes.service";
import {
  AdminFareQuoteQueryDto,
  SimulateFareQuoteDto,
} from "./dto/fare-quote.dto";

/**
 * واجهة اللوحة لعروض السعر (STAFF + pricing.manage):
 * معاينة/تدقيق العروض + محاكاة السعر والنطاق (قراءة فقط، دون حفظ).
 */
@Controller("admin/fare-quotes")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("pricing.manage")
export class FareQuotesAdminController {
  constructor(private readonly service: FareQuotesService) {}

  @Get()
  list(@Query() query: AdminFareQuoteQueryDto) {
    return this.service.adminList(query);
  }

  @Post("simulate")
  simulate(@Body() dto: SimulateFareQuoteDto) {
    return this.service.simulate(dto);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.service.adminGet(id);
  }
}
