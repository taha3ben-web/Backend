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
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CreatePaymentCheckoutDto,
  PaymentActionDto,
  UpdatePaymentStatusDto,
} from "./dto/payments.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

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

  @Get("summary")
  summary(
    @Query("status") status?: PaymentStatus,
    @Query("method") method?: PaymentMethod,
    @Query("provider") provider?: string,
    @Query("search") search?: string,
  ) {
    return this.payments.summary(status, method, provider, search);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.payments.findOne(id);
  }

  @Post("trip/:tripId/checkout")
  createCheckout(
    @Param("tripId") tripId: string,
    @Body() dto: CreatePaymentCheckoutDto,
  ) {
    return this.payments.createCheckoutForTrip(tripId, dto);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdatePaymentStatusDto) {
    return this.payments.updateStatus(id, dto.status, dto.reference, dto.reason);
  }

  @Post(":id/capture")
  capture(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.capture(id, dto.reference, dto.reason);
  }

  @Post(":id/refund")
  refund(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.refund(id, dto.reference, dto.reason);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: PaymentActionDto) {
    return this.payments.cancel(id, dto.reference, dto.reason);
  }
}
