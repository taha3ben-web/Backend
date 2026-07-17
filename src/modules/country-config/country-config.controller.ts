import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CountryConfigService,
  UpsertCountryConfigInput,
} from "./country-config.service";

@Controller("country-config")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class CountryConfigController {
  constructor(private readonly countries: CountryConfigService) {}

  @RequirePermissions("settings.manage")
  @Get()
  list() {
    return this.countries.list();
  }

  @RequirePermissions("settings.manage")
  @Get(":code")
  get(@Param("code") code: string) {
    return this.countries.get(code);
  }

  @RequirePermissions("settings.manage")
  @Get(":code/tax")
  tax(@Param("code") code: string, @Query("amount") amount: string) {
    return this.countries.taxFor(code, Number(amount));
  }

  @RequirePermissions("settings.manage")
  @Get(":code/phone")
  phone(@Param("code") code: string, @Query("value") value: string) {
    return this.countries
      .normalizePhone(code, value)
      .then((e164) => ({ input: value, e164, valid: e164 !== null }));
  }

  @RequirePermissions("settings.manage")
  @Put(":code")
  upsert(
    @Param("code") code: string,
    @Body() body: Omit<UpsertCountryConfigInput, "code">,
  ) {
    return this.countries.upsert({ ...body, code });
  }
}
