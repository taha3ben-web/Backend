import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { SendTripMessageDto } from "./dto/trip-communication.dto";
import { TripCommunicationService } from "./trip-communication.service";

@Controller("trip-communication")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER", "DRIVER")
export class TripCommunicationController {
  constructor(private readonly communication: TripCommunicationService) {}

  @Get(":tripId")
  context(@CurrentUser() user: AuthUser, @Param("tripId") tripId: string) {
    return this.communication.context(user.userId, tripId);
  }

  @Get(":tripId/messages")
  messages(@CurrentUser() user: AuthUser, @Param("tripId") tripId: string, @Query() q: PaginationDto) {
    return this.communication.messages(user.userId, tripId, q);
  }

  @Post(":tripId/messages")
  send(@CurrentUser() user: AuthUser, @Param("tripId") tripId: string, @Body() dto: SendTripMessageDto) {
    return this.communication.send(user.userId, tripId, dto.body);
  }
}
