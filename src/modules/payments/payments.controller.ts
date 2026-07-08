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
import { CreatePaymentDto, UpdatePaymentStatusDto } from "./dto/payments.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: PaymentStatus) {
    return this.payments.findAll(q, status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.payments.findOne(id);
  }

  @Post()
  record(@Body() dto: CreatePaymentDto) {
    return this.payments.recordForTrip(
      dto.tripId,
      dto.method ?? PaymentMethod.CASH,
      dto.reference,
    );
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdatePaymentStatusDto) {
    return this.payments.updateStatus(id, dto.status, dto.reference);
  }
}
