import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PaymentsService } from "./payments.service";

@Controller("payments/webhooks")
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":provider")
  receive(
    @Param("provider") provider: string,
    @Body() payload: Record<string, unknown>,
    @Req() request: Request & { rawBody?: Buffer },
    @Headers("x-webhook-signature") signature?: string,
    @Headers("x-webhook-id") eventId?: string,
  ) {
    const rawBody = request.rawBody?.toString("utf8");
    if (!rawBody || !this.payments.verifyWebhook(rawBody, signature)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    return this.payments.processWebhook(provider, payload, eventId);
  }
}
