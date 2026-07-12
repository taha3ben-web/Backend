import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { DriverQrService } from "./driver-qr.service";
import { DriverQrIssueDto } from "./dto/driver-qr.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("qr.read", "qr.manage")
@Controller("drivers/:driverId/qr")
export class DriverQrController {
  constructor(private readonly qr: DriverQrService) {}

  @Get()
  getCurrent(@Param("driverId") driverId: string) {
    return this.qr.getActiveForDriver(driverId);
  }

  @Post("issue")
  issue(
    @Param("driverId") driverId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DriverQrIssueDto,
  ) {
    return this.qr.issue(driverId, user.userId, dto.expiresInDays ?? 90);
  }

  @Post("rotate")
  rotate(
    @Param("driverId") driverId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: DriverQrIssueDto,
  ) {
    return this.qr.rotate(driverId, user.userId, dto.expiresInDays ?? 90);
  }

  @Post("revoke")
  revoke(@Param("driverId") driverId: string, @CurrentUser() user: AuthUser) {
    return this.qr.revoke(driverId, user.userId);
  }
}
