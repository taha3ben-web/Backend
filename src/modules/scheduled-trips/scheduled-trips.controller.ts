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
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import {
  ScheduledTripsService,
  CreateScheduledTripInput,
} from "./scheduled-trips.service";

@Controller("trips/scheduled")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScheduledTripsController {
  constructor(private readonly service: ScheduledTripsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: Omit<CreateScheduledTripInput, "passengerId">,
  ) {
    return this.service.create({ ...body, passengerId: user.userId });
  }

  @Get("mine")
  listMine(@CurrentUser() user: AuthUser) {
    return this.service.listUpcoming(user.userId);
  }

  @Get()
  listAll(@Query("passengerId") passengerId?: string) {
    return this.service.listUpcoming(passengerId);
  }

  @Delete(":id")
  cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }
}
