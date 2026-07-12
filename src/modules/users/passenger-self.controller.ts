import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UsersService } from "./users.service";
import { PassengerUploadUrlDto, UpdatePassengerProfileDto } from "./dto/passenger-self.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER")
@Controller("passenger")
export class PassengerSelfController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  me(@CurrentUser() actor: AuthUser) {
    return this.users.getPassengerProfile(actor.userId);
  }

  @Patch("me")
  update(@CurrentUser() actor: AuthUser, @Body() dto: UpdatePassengerProfileDto) {
    return this.users.updatePassengerProfile(actor.userId, dto);
  }

  @Post("me/upload-url")
  uploadUrl(@CurrentUser() actor: AuthUser, @Body() dto: PassengerUploadUrlDto) {
    return this.users.createPassengerUploadUrl(actor.userId, dto);
  }
}
