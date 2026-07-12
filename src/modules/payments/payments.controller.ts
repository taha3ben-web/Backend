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
  CreatePaymentCheckoutDto,
  PaymentActionDto,
  UpdatePaymentStatusDto,
} from "./dto/payments.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions("payments.read", "payments.manage")
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: PaymentStatus,
    @Query("method") method?: PaymentMethod,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.findAll(q, status, method, provider, search);
  }

  @Get("summary")
  @RequirePermissions("payments.read", "payments.manage", "reports.read")
  summary(
    @Query("status") status?: PaymentStatus,
    @Query("method") method?: PaymentMethod,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.summary(status, method, provider, search);
  }

  @Get(":id")
  @RequirePermissions("payments.read", "payments.manage")
  findOne(@Param("id") id: string) {
    return this.payments.findOne(id);
  }

  @Post("trip/:tripId/checkout")
  @RequirePermissions("payments.manage")
  createCheckout(
    @Param("tripId") tripId: string,
    @Body() dto: CreatePaymentCheckoutDto,
  ) {
    return this.payments.createCheckoutForTrip(tripId, dto);
  }

  @Patch(":id/status")
  @RequirePermissions("payments.manage")
  updateStatus(@Param("id") id: string, @Body() dto: UpdatePaymentStatusDto) {
    return this.payments.updateStatus(id, dto.status, dto.reference, dto.reason);
  }

  @Post(":id/capture")
  @RequirePermissions("payments.manage")
  capture(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.capture(id, dto.idempotencyKey, dto.reference, dto.reason);
  }

  @Post(":id/refund")
  @RequirePermissions("payments.manage")
  refund(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.refund(id, dto.idempotencyKey, dto.amount, dto.reference, dto.reason);
  }

  @Post(":id/cancel")
  @RequirePermissions("payments.manage")
  cancel(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.cancel(id, dto.idempotencyKey, dto.reference, dto.reason);
  }
}
