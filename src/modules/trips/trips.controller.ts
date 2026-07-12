import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { TripsService } from "./trips.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @RequirePermissions("trips.read", "trips.manage")
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: TripStatus,
    @Query("unsettledOnly") unsettledOnly?: string,
    @Query("search") search?: string,
  ) {
    return this.trips.findAll(q, status, unsettledOnly === "true", search);
  }

  @Get(":id")
  @RequirePermissions("trips.read", "trips.manage")
  findOne(@Param("id") id: string) {
    return this.trips.findOne(id);
  }

  @Patch(":id/status")
  @RequirePermissions("trips.manage")
  changeStatus(
    @Param("id") id: string,
    @Body() body: { status: TripStatus; reason?: string },
  ) {
    return this.trips.changeStatus(id, body.status, body.reason);
  }

  @Post(":id/retry-settlement")
  @RequirePermissions("trips.manage", "payments.manage")
  retrySettlement(@Param("id") id: string) {
    return this.trips.retrySettlement(id);
  }
}
