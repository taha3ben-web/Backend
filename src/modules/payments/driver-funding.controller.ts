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
import { FundingRequestStatus } from "@prisma/client";
import { DriverFundingService } from "./driver-funding.service";
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
import {
  CreateDriverFundingRequestDto,
  ProcessDriverFundingRequestDto,
} from "./dto/driver-funding.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF", "AGENT")
@Controller("driver-funding")
export class DriverFundingController {
  constructor(private readonly funding: DriverFundingService) {}

  @Get("requests")
  @RequirePermissions("funding.read", "funding.manage")
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: PaginationDto,
    @Query("status") status?: FundingRequestStatus,
    @Query("search") search?: string,
  ) {
    return this.funding.listRequests(user, q, status, search);
  }

  @Get("requests/:id")
  @RequirePermissions("funding.read", "funding.manage")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.funding.getRequest(user, id);
  }

  @Post("requests")
  @RequirePermissions("funding.manage")
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDriverFundingRequestDto,
  ) {
    return this.funding.createRequest(user, dto);
  }

  @Patch("requests/:id/approve")
  @RequirePermissions("funding.manage")
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverFundingRequestDto,
  ) {
    return this.funding.approve(user, id, dto.note);
  }

  @Patch("requests/:id/reject")
  @RequirePermissions("funding.manage")
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverFundingRequestDto,
  ) {
    return this.funding.reject(user, id, dto.note);
  }

  @Post("requests/:id/fund")
  @RequirePermissions("funding.manage")
  fund(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverFundingRequestDto,
  ) {
    return this.funding.markFunded(user, id, dto.note);
  }
}
