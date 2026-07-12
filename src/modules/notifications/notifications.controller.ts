import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { NotificationTarget } from "@prisma/client";
import { NotificationsService } from "./notifications.service";
import { DeviceTokensService } from "./device-tokens.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  ListNotificationsQueryDto,
  SendNotificationDto,
  RegisterDeviceDto,
  UpsertNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from "./dto/notifications.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
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

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get("templates")
  templates() {
    return this.notifications.listTemplates();
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Post("templates")
  upsertTemplate(@Body() dto: UpsertNotificationTemplateDto) {
    return this.notifications.upsertTemplate(dto);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Put("templates/:key")
  updateTemplate(
    @Param("key") key: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ) {
    return this.notifications.updateTemplate(key, dto);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Delete("templates/:key")
  removeTemplate(@Param("key") key: string) {
    return this.notifications.removeTemplate(key);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Post()
  send(@Body() dto: SendNotificationDto) {
    return this.notifications.send(dto);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get()
  findAll(@Query() q: ListNotificationsQueryDto) {
    return this.notifications.findAll(q);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Delete(":id")
  cancel(@Param("id") id: string) {
    return this.notifications.cancelScheduled(id);
  }
}
