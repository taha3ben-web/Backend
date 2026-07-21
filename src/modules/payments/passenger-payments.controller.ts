import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CreatePaymentCheckoutDto } from "./dto/payments.dto";
import { PaymentsService } from "./payments.service";

@Controller("passenger/payments")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER")
export class PassengerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get("methods")
  methods() {
    return this.payments.passengerMethods();
  }

  @Get("trip/:tripId")
  payment(@CurrentUser() user: AuthUser, @Param("tripId") tripId: string) {
    return this.payments.passengerPayment(user.userId, tripId);
  }

  @Post("trip/:tripId/checkout")
  checkout(
    @CurrentUser() user: AuthUser,
    @Param("tripId") tripId: string,
    @Body() dto: CreatePaymentCheckoutDto,
  ) {
    return this.payments.passengerCheckout(user.userId, tripId, dto);
  }
}
