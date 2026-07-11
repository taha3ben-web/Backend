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
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("drivers")
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: DriverStatus) {
    return this.drivers.findAll(q, status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.drivers.findOne(id);
  }

  @Patch(":id/approve")
  approve(@Param("id") id: string) {
    return this.drivers.setStatus(id, "APPROVED");
  }

  @Patch(":id/reject")
  reject(@Param("id") id: string) {
    return this.drivers.setStatus(id, "REJECTED");
  }

  @Patch(":id/suspend")
  suspend(@Param("id") id: string) {
    return this.drivers.setStatus(id, "SUSPENDED");
  }

  @Patch(":id/ban")
  ban(@Param("id") id: string) {
    return this.drivers.setStatus(id, "BANNED");
  }

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
