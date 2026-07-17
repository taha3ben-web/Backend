import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { DriverStatus } from "@prisma/client";
import { DriversService } from "./drivers.service";
import { DriverSanctionsService } from "./driver-sanctions.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("drivers")
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly sanctions: DriverSanctionsService,
  ) {}

  // ===== نظام عقوبات الإلغاء (Stage 65) =====

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get("sanctions/config")
  sanctionsConfig() {
    return this.sanctions.getConfig();
  }

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get("sanctions/suspended")
  suspendedDrivers() {
    return this.sanctions.listSuspended();
  }

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get("sanctions/log")
  sanctionsLog(@Query() q: PaginationDto) {
    return this.sanctions.listSanctions(q);
  }

  @RequirePermissions("drivers.manage")
  @Patch("sanctions/:id/lift")
  liftSuspension(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.sanctions.liftSuspension(id, user.userId);
  }

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: DriverStatus) {
    return this.drivers.findAll(q, status);
  }

  @RequirePermissions("drivers.read", "drivers.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.drivers.findOne(id);
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/approve")
  approve(@Param("id") id: string) {
    return this.drivers.setStatus(id, "APPROVED");
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/reject")
  reject(@Param("id") id: string) {
    return this.drivers.setStatus(id, "REJECTED");
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/suspend")
  suspend(@Param("id") id: string) {
    return this.drivers.setStatus(id, "SUSPENDED");
  }

  @RequirePermissions("drivers.manage")
  @Patch(":id/ban")
  ban(@Param("id") id: string) {
    return this.drivers.setStatus(id, "BANNED");
  }

  @RequirePermissions("drivers.documents", "drivers.manage")
  @Patch("documents/:docId/review")
  reviewDocument(
    @Param("docId") docId: string,
    @Body() body: { status: "APPROVED" | "REJECTED"; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.drivers.reviewDocument(
      docId,
      body.status,
      user.userId,
      body.note,
    );
  }
}
