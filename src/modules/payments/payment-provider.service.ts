import { BadRequestException, Injectable } from "@nestjs/common";
import { PaymentMethod, PaymentStatus } from "@prisma/client";

export interface PaymentCheckoutResult {
  provider: string;
  providerPaymentId: string;
  providerStatus: string;
  reference?: string;
  statusReason?: string;
  checkoutUrl: string | null;
  payload: Record<string, unknown>;
}

export interface PaymentActionResult {
  provider: string;
  providerStatus: string;
  reference?: string;
  statusReason?: string;
  payload: Record<string, unknown>;
}

export interface NormalizedWebhookEvent {
  provider: string;
  eventType: string;
  providerPaymentId?: string;
  internalPaymentId?: string;
  reference?: string;
  status?: PaymentStatus;
  providerStatus?: string;
  reason?: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class PaymentProviderService {
  resolveProvider(method: PaymentMethod, provider?: string): string {
    const normalized = provider?.trim().toLowerCase();
    if (normalized) return normalized;
    switch (method) {
      case "CARD":
        throw new BadRequestException("No card payment provider is configured");
      case "WALLET":
        return "wallet";
      case "CASH":
      default:
        return "cash";
    }
  }

  async createCheckout(input: {
    paymentId: string;
    tripId: string;
    method: PaymentMethod;
    amount: number;
    currency: string;
    provider?: string;
    returnUrl?: string;
    cancelUrl?: string;
  }): Promise<PaymentCheckoutResult> {
    const provider = this.resolveProvider(input.method, input.provider);
    if (input.method === "WALLET") {
      return {
        provider,
        providerPaymentId: `wallet:${input.paymentId}`,
        providerStatus: "balance_verified",
        checkoutUrl: null,
        payload: {
          source: "wallet_balance",
          amount: input.amount,
          currency: input.currency,
        },
      };
    }
    if (input.method === "CASH") {
      return {
        provider,
        providerPaymentId: `cash:${input.paymentId}`,
        providerStatus: "collect_on_trip_completion",
        checkoutUrl: null,
        payload: {
          source: "cash_collection",
          amount: input.amount,
          currency: input.currency,
        },
      };
    }
    throw new BadRequestException(
      `Payment provider ${provider} has no active checkout adapter`,
    );
  }

  async capture(input: {
    paymentId: string;
    provider: string;
    amount: number;
    currency: string;
  }): Promise<PaymentActionResult> {
    return {
      provider: input.provider,
      providerStatus: "captured",
      payload: {
        action: "capture",
        paymentId: input.paymentId,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }

  async refund(input: {
    paymentId: string;
    provider: string;
    amount: number;
    currency: string;
  }): Promise<PaymentActionResult> {
    return {
      provider: input.provider,
      providerStatus: "refunded",
      payload: {
        action: "refund",
        paymentId: input.paymentId,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }

  async cancel(input: {
    paymentId: string;
    provider: string;
  }): Promise<PaymentActionResult> {
    return {
      provider: input.provider,
      providerStatus: "canceled",
      payload: {
        action: "cancel",
        paymentId: input.paymentId,
      },
    };
  }

  normalizeWebhook(
    provider: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): NormalizedWebhookEvent {
    const providerPaymentId = this.readString(
      payload.providerPaymentId,
      payload.paymentId,
      payload.provider_payment_id,
      payload.transactionId,
      payload.transaction_id,
      payload.id,
    );
    const internalPaymentId = this.readString(
      payload.internalPaymentId,
      payload.internal_payment_id,
      payload.metadata && typeof payload.metadata === "object"
        ? (payload.metadata as Record<string, unknown>).paymentId
        : undefined,
    );
    const reference = this.readString(
      payload.reference,
      payload.orderId,
      payload.order_id,
    );
    const providerStatus = this.readString(
      payload.status,
      payload.paymentStatus,
      payload.payment_status,
      payload.event,
      payload.type,
    );
    const eventType =
      this.readString(payload.type, payload.event, providerStatus) ?? "provider_event";
    const reason = this.readString(
      payload.reason,
      payload.failureReason,
      payload.failure_reason,
      payload.message,
    );
    const status = this.mapProviderStatus(providerStatus);
    const idempotencyKey =
      eventId ??
      this.readString(
        payload.idempotencyKey,
        payload.idempotency_key,
        payload.eventId,
        payload.event_id,
      ) ??
      `${provider}:${providerPaymentId ?? internalPaymentId ?? reference ?? eventType}`;

    return {
      provider,
      eventType,
      providerPaymentId,
      internalPaymentId,
      reference,
      status,
      providerStatus: providerStatus ?? eventType,
      reason,
      idempotencyKey,
      payload,
    };
  }

  private mapProviderStatus(value?: string): PaymentStatus | undefined {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return undefined;
    switch (normalized) {
      case "pending":
      case "created":
      case "initiated":
        return "PENDING";
      case "authorized":
      case "authorised":
      case "requires_capture":
        return "AUTHORIZED";
      case "captured":
      case "paid":
      case "succeeded":
      case "settled":
        return "CAPTURED";
      case "failed":
      case "declined":
      case "rejected":
        return "FAILED";
      case "refunded":
      case "refund":
        return "REFUNDED";
      case "canceled":
      case "cancelled":
      case "voided":
        return "CANCELED";
      default:
        return undefined;
    }
  }

  private readString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  }
}
