import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { GdprService } from "./gdpr.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER")
@Controller("passenger")
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  /** تنزيل نسخة كاملة من بياناتي الشخصية (GDPR). */
  @Get("me/export")
  exportMyData(@CurrentUser() actor: AuthUser) {
    return this.gdpr.exportUserData(actor.userId);
  }
}
