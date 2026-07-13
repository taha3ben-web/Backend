import { Controller, Param, Patch, Query, UseGuards, Get } from "@nestjs/common";
import { RideClass } from "@prisma/client";
import { VehiclesService } from "./vehicles.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@Controller("vehicles")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get()
  findAll(@Query() q: PaginationDto, @Query("rideClass") rideClass?: RideClass) {
    return this.vehicles.findAll(q, rideClass);
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/toggle")
  toggle(@Param("id") id: string) {
    return this.vehicles.toggle(id);
  }
}
