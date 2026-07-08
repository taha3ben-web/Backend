import { Controller, Param, Patch, Query, UseGuards, Get } from "@nestjs/common";
import { RideClass } from "@prisma/client";
import { VehiclesService } from "./vehicles.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@Controller("vehicles")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("rideClass") rideClass?: RideClass) {
    return this.vehicles.findAll(q, rideClass);
  }

  @Patch(":id/toggle")
  toggle(@Param("id") id: string) {
    return this.vehicles.toggle(id);
  }
}
