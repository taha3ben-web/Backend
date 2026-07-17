import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { NotificationTarget } from "@prisma/client";
import { NotificationsService } from "./notifications.service";
import { DeviceTokensService } from "./device-tokens.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  SendNotificationDto,
  RegisterDeviceDto,
} from "./dto/notifications.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  @Post("devices")
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.deviceTokens.register(user.userId, dto.token, dto.platform);
  }

  @Delete("devices/:token")
  removeDevice(@Param("token") token: string) {
    return this.deviceTokens.remove(token);
  }

  @Get("me")
  myNotifications(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    const targets: NotificationTarget[] =
      user.role === "DRIVER"
        ? ["ALL", "DRIVERS"]
        : user.role === "PASSENGER"
          ? ["ALL", "PASSENGERS"]
          : ["ALL"];
    return this.notifications.forUser(user.userId, targets, q);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("notifications.send")
  @Post()
  send(@Body() dto: SendNotificationDto) {
    return this.notifications.send(dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("notifications.send")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("target") target?: NotificationTarget,
    @Query("campaignKey") campaignKey?: string,
  ) {
    return this.notifications.findAll(q, target, campaignKey);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("notifications.send")
  @Delete(":id")
  cancel(@Param("id") id: string) {
    return this.notifications.cancelScheduled(id);
  }
}
