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

  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.userId);
  }

  @Delete(":id")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.sessions.revoke(user.userId, id);
  }

  @Delete()
  revokeAll(@CurrentUser() user: AuthUser) {
    return this.sessions.revokeAll(user.userId);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("audit.read", "staff.manage")
  @Get("user/:userId")
  forUser(@Param("userId") userId: string) {
    return this.sessions.listForUser(userId);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("audit.read", "staff.manage")
  @Delete("user/:userId/:id")
  revokeForUser(
    @Param("userId") userId: string,
    @Param("id") id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sessions.revokeForUser(userId, id, actor.userId);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("audit.read", "staff.manage")
  @Delete("user/:userId")
  revokeAllForUser(
    @Param("userId") userId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.sessions.revokeAllForUser(userId, actor.userId);
  }
}
