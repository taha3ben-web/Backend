import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SafetyIncidentStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { SafetyService } from "./safety.service";
import {
  CreateSafetyIncidentDto,
  ResolveSafetyIncidentDto,
} from "./dto/safety.dto";

@UseGuards(JwtAuthGuard)
@Controller("safety/incidents")
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSafetyIncidentDto) {
    return this.safety.create(user.userId, dto);
  }

  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.safety.mine(user.userId);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("safety.manage")
  @Get()
  list(
    @Query() q: PaginationDto,
    @Query("status") status?: SafetyIncidentStatus,
  ) {
    return this.safety.list(q, status);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("safety.manage")
  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ResolveSafetyIncidentDto,
  ) {
    return this.safety.updateStatus(id, user.userId, dto);
  }
}
