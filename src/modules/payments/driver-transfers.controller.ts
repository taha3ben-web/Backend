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
import { DriverTransferStatus } from "@prisma/client";
import { DriverTransfersService } from "./driver-transfers.service";
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
  CreateDriverTransferDto,
  ProcessDriverTransferDto,
} from "./dto/driver-transfer.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF", "AGENT")
@Controller("driver-transfers")
export class DriverTransfersController {
  constructor(private readonly transfers: DriverTransfersService) {}

  @Get()
  @RequirePermissions("transfer.read", "transfer.manage")
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: PaginationDto,
    @Query("status") status?: DriverTransferStatus,
    @Query("search") search?: string,
  ) {
    return this.transfers.list(user, q, status, search);
  }

  @Get(":id")
  @RequirePermissions("transfer.read", "transfer.manage")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.transfers.getOne(user, id);
  }

  @Post()
  @RequirePermissions("transfer.manage")
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDriverTransferDto,
  ) {
    return this.transfers.create(user, dto);
  }

  @Patch(":id/approve")
  @RequirePermissions("transfer.manage")
  approve(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverTransferDto,
  ) {
    return this.transfers.approve(user, id, dto.note);
  }

  @Patch(":id/reject")
  @RequirePermissions("transfer.manage")
  reject(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverTransferDto,
  ) {
    return this.transfers.reject(user, id, dto.note);
  }

  @Post(":id/complete")
  @RequirePermissions("transfer.manage")
  complete(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProcessDriverTransferDto,
  ) {
    return this.transfers.complete(user, id, dto.note);
  }
}
