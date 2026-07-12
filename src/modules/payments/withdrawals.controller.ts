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
import { WithdrawStatus } from "@prisma/client";
import { WithdrawalsService } from "./withdrawals.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateWithdrawDto, ProcessWithdrawDto } from "./dto/payments.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("withdrawals")
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWithdrawDto) {
    return this.withdrawals.createForDriver(user.userId, dto.amount, dto.note);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: WithdrawStatus,
    @Query("search") search?: string,
  ) {
    return this.withdrawals.findAll(q, status, search);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get("summary")
  summary(@Query("status") status?: WithdrawStatus, @Query("search") search?: string) {
    return this.withdrawals.summary(status, search);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":id/approve")
  approve(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.approve(id, user.userId, dto.note);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":id/paid")
  markPaid(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.markPaid(id, user.userId, dto.note);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":id/reject")
  reject(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.reject(id, user.userId, dto.note);
  }
}
