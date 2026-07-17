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
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import { PaymentsService } from "./payments.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import {
  CreatePaymentCheckoutDto,
  PaymentActionDto,
  UpdatePaymentStatusDto,
} from "./dto/payments.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions("payments.read", "payments.manage")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: PaymentStatus,
    @Query("method") method?: PaymentMethod,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.findAll(q, status, method, provider, search);
  }

  @RequirePermissions("payments.read", "payments.manage")
  @Get("summary")
  summary(
    @Query("status") status?: PaymentStatus,
    @Query("method") method?: PaymentMethod,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.summary(status, method, provider, search);
  }

  @RequirePermissions("payments.read", "payments.manage")
  @Get("refunds")
  refunds(
    @Query() q: PaginationDto,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.findRefunds(q, provider, search);
  }

  @RequirePermissions("payments.read", "payments.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.payments.findOne(id);
  }

  @RequirePermissions("payments.manage")
  @Post("trip/:tripId/checkout")
  createCheckout(
    @Param("tripId") tripId: string,
    @Body() dto: CreatePaymentCheckoutDto,
  ) {
    return this.payments.createCheckoutForTrip(tripId, dto);
  }

  @RequirePermissions("payments.manage")
  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.payments.updateStatus(
      id,
      dto.status,
      dto.reference,
      dto.reason,
      undefined,
      user.userId,
    );
  }

  @RequirePermissions("payments.manage")
  @Post(":id/capture")
  capture(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: PaymentActionDto,
  ) {
    return this.payments.capture(id, dto.reference, dto.reason, user.userId);
  }

  @RequirePermissions("payments.manage")
  @Post(":id/refund")
  refund(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: PaymentActionDto,
  ) {
    return this.payments.refund(id, dto.reference, dto.reason, user.userId);
  }

  @RequirePermissions("payments.manage")
  @Post(":id/cancel")
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: PaymentActionDto,
  ) {
    return this.payments.cancel(id, dto.reference, dto.reason, user.userId);
  }
}
