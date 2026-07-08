import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { TripsService } from "./trips.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: TripStatus) {
    return this.trips.findAll(q, status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.trips.findOne(id);
  }

  @Patch(":id/status")
  changeStatus(
    @Param("id") id: string,
    @Body() body: { status: TripStatus; reason?: string },
  ) {
    return this.trips.changeStatus(id, body.status, body.reason);
  }
}
