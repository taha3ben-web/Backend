import { Body, Controller, Param, Patch, Query, UseGuards, Get } from "@nestjs/common";
import { RideClass, VehicleVerificationStatus } from "@prisma/client";
import { VehiclesService } from "./vehicles.service";
import { ReviewVehicleDto } from "./dto/review-vehicle.dto";
import { ReclassifyVehicleDto } from "./dto/reclassify-vehicle.dto";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { CurrentUser, AuthUser } from "../../common/decorators/current-user.decorator";

@Controller("vehicles")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("rideClass") rideClass?: RideClass,
    @Query("status") status?: VehicleVerificationStatus,
  ) {
    return this.vehicles.findAll(q, rideClass, status);
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/toggle")
  toggle(@Param("id") id: string) {
    return this.vehicles.toggle(id);
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/verify")
  verify(
    @Param("id") id: string,
    @Body() dto: ReviewVehicleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vehicles.review(
      id,
      dto.status,
      user.userId,
      dto.note,
      dto.rideClass,
      dto.vehicleTypeId,
    );
  }

  /** تصحيح فئة/نوع مركبة معتمدة مسبقًا، بلا إعادة فتح دورة المراجعة. */
  @RequirePermissions("drivers.manage")
  @Patch(":id/reclassify")
  reclassify(@Param("id") id: string, @Body() dto: ReclassifyVehicleDto) {
    return this.vehicles.reclassify(id, dto.rideClass, dto.vehicleTypeId);
  }
}
