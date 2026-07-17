import {
  Body,
  Controller,
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
import { CityScalingService, UpsertControlInput } from "./city-scaling.service";
import { CityLaunchStatus } from "./city-scaling.util";

@Controller("cities/scaling")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class CityScalingController {
  constructor(private readonly service: CityScalingService) {}

  @Post()
  upsert(@Body() body: UpsertControlInput, @CurrentUser() user: AuthUser) {
    return this.service.upsert(body, user.userId);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":cityId")
  get(@Param("cityId") cityId: string) {
    return this.service.get(cityId);
  }

  @Patch(":cityId/launch-status")
  changeStatus(
    @Param("cityId") cityId: string,
    @Body("status") status: CityLaunchStatus,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.changeLaunchStatus(cityId, status, user.userId);
  }

  @Get(":cityId/acceptance")
  acceptance(
    @Param("cityId") cityId: string,
    @Query("rideClass") rideClass = "ECONOMY",
  ) {
    return this.service.evaluateAcceptance(cityId, rideClass);
  }
}
