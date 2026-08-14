import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserType } from "@prisma/client";
import { UsersService } from "./users.service";
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
@Controller("passengers")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions("passengers.read", "passengers.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.users.findAll(q, UserType.PASSENGER);
  }

  @RequirePermissions("passengers.read", "passengers.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.users.findOne(id);
  }

  @RequirePermissions("passengers.read", "passengers.manage")
  @Get(":id/overview")
  overview(@Param("id") id: string) {
    return this.users.customer360(id);
  }

  @RequirePermissions("passengers.read", "passengers.manage")
  @Get(":id/trips")
  trips(@Param("id") id: string, @Query() q: PaginationDto) {
    return this.users.trips(id, q);
  }

  @RequirePermissions("passengers.manage")
  @Patch(":id/suspend")
  suspend(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body?: { reason?: string },
  ) {
    return this.users.setStatus(id, "SUSPENDED", {
      userId: user.userId,
      reason: body?.reason,
    });
  }

  @RequirePermissions("passengers.manage")
  @Patch(":id/ban")
  ban(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body?: { reason?: string },
  ) {
    return this.users.setStatus(id, "BANNED", {
      userId: user.userId,
      reason: body?.reason,
    });
  }

  /**
   * فك التجميد — المسار الوحيد المسموح (لوحة التحكم + موطف مخوّل).
   * لا يوجد أي مسار مكافئ في PassengerApp أو DriverApp.
   */
  @RequirePermissions("passengers.manage")
  @Patch(":id/activate")
  activate(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() body?: { reason?: string },
  ) {
    return this.users.setStatus(id, "ACTIVE", {
      userId: user.userId,
      reason: body?.reason,
    });
  }
}
