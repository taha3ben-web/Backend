import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { PaymentsService } from "./payments.service";

@Controller("payments/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":provider")
  receive(
    @Param("provider") provider: string,
    @Body() payload: Record<string, unknown>,
    @Headers("x-webhook-token") token?: string,
    @Headers("x-webhook-id") eventId?: string,
  ) {
    const expectedToken = process.env.PAYMENT_WEBHOOK_TOKEN?.trim();
    if (expectedToken && token?.trim() !== expectedToken) {
      throw new UnauthorizedException("Webhook token غير صالح");
    }
    return this.payments.processWebhook(provider, payload, eventId);
  }
}
