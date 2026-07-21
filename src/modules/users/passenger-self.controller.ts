import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UsersService } from "./users.service";
import { PassengerUploadUrlDto, RequestAccountDeletionDto, UpdatePassengerProfileDto } from "./dto/passenger-self.dto";

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

  @Get("me/deletion-request")
  deletionRequest(@CurrentUser() actor: AuthUser) {
    return this.users.getPassengerDeletionRequest(actor.userId);
  }

  @Post("me/deletion-request")
  requestDeletion(@CurrentUser() actor: AuthUser, @Body() dto: RequestAccountDeletionDto) {
    return this.users.requestPassengerDeletion(actor.userId, dto.confirmation, dto.reason);
  }

  @Delete("me/deletion-request")
  cancelDeletion(@CurrentUser() actor: AuthUser) {
    return this.users.cancelPassengerDeletion(actor.userId);
  }
}
