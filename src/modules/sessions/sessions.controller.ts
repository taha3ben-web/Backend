import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
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
    return this.sessions.revokeAll(user.userId, user.sessionId);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get("user/:userId")
  forUser(@Param("userId") userId: string) {
    return this.sessions.listForUser(userId);
  }
}
