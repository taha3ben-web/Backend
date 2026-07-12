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
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions("drivers.read", "drivers.manage")
  findAll(@Query() q: PaginationDto, @Query("status") status?: DriverStatus) {
    return this.drivers.findAll(q, status);
  }

  @Get(":id")
  @RequirePermissions("drivers.read", "drivers.manage")
  findOne(@Param("id") id: string) {
    return this.drivers.findOne(id);
  }

  @Patch(":id/approve")
  @RequirePermissions("drivers.manage")
  approve(@Param("id") id: string) {
    return this.drivers.setStatus(id, "APPROVED");
  }

  @Patch(":id/reject")
  @RequirePermissions("drivers.manage")
  reject(@Param("id") id: string) {
    return this.drivers.setStatus(id, "REJECTED");
  }

  @Patch(":id/suspend")
  @RequirePermissions("drivers.manage")
  suspend(@Param("id") id: string) {
    return this.drivers.setStatus(id, "SUSPENDED");
  }

  @Patch(":id/ban")
  @RequirePermissions("drivers.manage")
  ban(@Param("id") id: string) {
    return this.drivers.setStatus(id, "BANNED");
  }

  @Patch("documents/:docId/review")
  @RequirePermissions("drivers.documents", "drivers.manage")
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
