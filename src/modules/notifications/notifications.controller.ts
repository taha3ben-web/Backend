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

  /** تسجيل توكن جهاز (أي مستخدم) */
  @Post("devices")
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.deviceTokens.register(user.userId, dto.token, dto.platform);
  }

  /** إزالة توكن جهاز */
  @Delete("devices/:token")
  removeDevice(@Param("token") token: string) {
    return this.deviceTokens.remove(token);
  }

  /** إشعارات المستخدم الحالي */
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

  // ---------- إدارة (STAFF) ----------

  /** إرسال إشعار (للجميع/السائقين/الركاب/مستخدم) — فوري أو مجدول */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Post()
  send(@Body() dto: SendNotificationDto) {
    return this.notifications.send(dto);
  }

  /** سجل الإشعارات */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("target") target?: NotificationTarget,
  ) {
    return this.notifications.findAll(q, target);
  }

  /** إلغاء إشعار مجدول لم يُرسل بعد */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Delete(":id")
  cancel(@Param("id") id: string) {
    return this.notifications.cancelScheduled(id);
  }
}
