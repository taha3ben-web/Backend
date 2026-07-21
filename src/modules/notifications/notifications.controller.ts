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
import { NotificationTarget } from "@prisma/client";
import { NotificationsService } from "./notifications.service";
import { DeviceTokensService } from "./device-tokens.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  SendNotificationDto,
  RegisterDeviceDto,
  MarkNotificationReadDto,
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
  removeDevice(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    return this.deviceTokens.remove(user.userId, token);
  }

  @Get("me")
  myNotifications(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.notifications.forUser(user.userId, this.targets(user), q);
  }

  @Patch("me/:id/read")
  markRead(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: MarkNotificationReadDto) {
    return this.notifications.setRead(user.userId, this.targets(user), id, dto.read);
  }

  @Post("me/read-all")
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId, this.targets(user));
  }

  @Delete("me/:id")
  deleteMine(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.notifications.deleteForUser(user.userId, this.targets(user), id);
  }

  @Delete("me")
  deleteAllMine(@CurrentUser() user: AuthUser) {
    return this.notifications.deleteAllForUser(user.userId, this.targets(user));
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

  private targets(user: AuthUser): NotificationTarget[] {
    return user.role === "DRIVER"
      ? ["ALL", "DRIVERS"]
      : user.role === "PASSENGER"
        ? ["ALL", "PASSENGERS"]
        : ["ALL"];
  }
}
