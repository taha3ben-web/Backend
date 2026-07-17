import {
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
  suspend(@Param("id") id: string) {
    return this.users.setStatus(id, "SUSPENDED");
  }

  @RequirePermissions("passengers.manage")
  @Patch(":id/ban")
  ban(@Param("id") id: string) {
    return this.users.setStatus(id, "BANNED");
  }

  @RequirePermissions("passengers.manage")
  @Patch(":id/activate")
  activate(@Param("id") id: string) {
    return this.users.setStatus(id, "ACTIVE");
  }
}
