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

  @Get()
  @RequirePermissions("passengers.read", "passengers.manage")
  findAll(@Query() q: PaginationDto) {
    return this.users.findAll(q, UserType.PASSENGER);
  }

  @Get(":id")
  @RequirePermissions("passengers.read", "passengers.manage")
  findOne(@Param("id") id: string) {
    return this.users.findOne(id);
  }

  @Get(":id/trips")
  @RequirePermissions("passengers.read", "passengers.manage", "trips.read")
  trips(@Param("id") id: string, @Query() q: PaginationDto) {
    return this.users.trips(id, q);
  }

  @Patch(":id/suspend")
  @RequirePermissions("passengers.manage")
  suspend(@Param("id") id: string) {
    return this.users.setStatus(id, "SUSPENDED");
  }

  @Patch(":id/ban")
  @RequirePermissions("passengers.manage")
  ban(@Param("id") id: string) {
    return this.users.setStatus(id, "BANNED");
  }

  @Patch(":id/activate")
  @RequirePermissions("passengers.manage")
  activate(@Param("id") id: string) {
    return this.users.setStatus(id, "ACTIVE");
  }
}
