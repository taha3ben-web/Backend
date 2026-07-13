import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
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
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** جلسات المستخدم الحالي */
  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.userId);
  }

  /** إنهاء جلسة واحدة */
  @Delete(":id")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.sessions.revoke(user.userId, id);
  }

  /** إنهاء كل الجلسات */
  @Delete()
  revokeAll(@CurrentUser() user: AuthUser) {
    return this.sessions.revokeAll(user.userId);
  }

  // ---------- إدارة (STAFF) ----------

  /** جلسات مستخدم معيّن */
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("audit.read", "staff.manage")
  @Get("user/:userId")
  forUser(@Param("userId") userId: string) {
    return this.sessions.listForUser(userId);
  }
}
