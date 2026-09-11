import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { WithdrawStatus } from "@prisma/client";
import { WithdrawalsService } from "./withdrawals.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ProcessWithdrawDto } from "./dto/payments.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

/**
 * إدارة طلبات السحب **القائمة** فقط (لوحة التحكم).
 *
 * مسار الإنشاء `POST /withdrawals` أُزيل: لا يوجد سحب ولا صرف نقدي في
 * نموذج عمل flaminGO لا للراكب ولا للسائق (انظر WithdrawalsService).
 * بقيت مسارات الطاقم كي تُنهي اللوحة ما كان معلّقًا قبل التصحيح ولتبقى
 * التقارير التاريخية متاحة — بلا حذف أي بيانات أو مايغريشن.
 */
@UseGuards(JwtAuthGuard)
@Controller("withdrawals")
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.read", "payments.manage")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: WithdrawStatus,
    @Query("search") search?: string,
  ) {
    return this.withdrawals.findAll(q, status, search);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.read", "payments.manage")
  @Get("summary")
  summary(@Query("status") status?: WithdrawStatus, @Query("search") search?: string) {
    return this.withdrawals.summary(status, search);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.read", "payments.manage")
  @Get("payout-integrity")
  payoutIntegrity(@Query("limit") limit?: string) {
    return this.withdrawals.payoutIntegrity(limit ? Number(limit) : 50);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.read", "payments.manage")
  @Get("settlement-proposal")
  settlementProposal(@Query("limit") limit?: string) {
    return this.withdrawals.settlementProposal(limit ? Number(limit) : 100);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.manage")
  @Patch(":id/approve")
  approve(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.approve(id, user.userId, dto.note);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.manage")
  @Patch(":id/paid")
  markPaid(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.markPaid(id, user.userId, dto.note);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("payments.manage")
  @Patch(":id/reject")
  reject(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ProcessWithdrawDto,
  ) {
    return this.withdrawals.reject(id, user.userId, dto.note);
  }
}
