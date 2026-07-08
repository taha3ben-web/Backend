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
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("passengers")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.users.findAll(q, UserType.PASSENGER);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.users.findOne(id);
  }

  @Get(":id/trips")
  trips(@Param("id") id: string, @Query() q: PaginationDto) {
    return this.users.trips(id, q);
  }

  @Patch(":id/suspend")
  suspend(@Param("id") id: string) {
    return this.users.setStatus(id, "SUSPENDED");
  }

  @Patch(":id/ban")
  ban(@Param("id") id: string) {
    return this.users.setStatus(id, "BANNED");
  }

  @Patch(":id/activate")
  activate(@Param("id") id: string) {
    return this.users.setStatus(id, "ACTIVE");
  }
}
