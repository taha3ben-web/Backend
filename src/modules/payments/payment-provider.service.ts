import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "crypto";
import { PaymentMethod, PaymentStatus } from "@prisma/client";

export interface PaymentCheckoutResult { provider: string; providerPaymentId: string; providerStatus: string; reference?: string; statusReason?: string; checkoutUrl: string | null; payload: Record<string, unknown>; }
export interface PaymentActionResult { provider: string; providerStatus: string; reference?: string; statusReason?: string; payload: Record<string, unknown>; }
export interface NormalizedWebhookEvent { provider: string; eventType: string; providerPaymentId?: string; internalPaymentId?: string; reference?: string; status?: PaymentStatus; providerStatus?: string; reason?: string; idempotencyKey: string; payload: Record<string, unknown>; }

@Injectable()
export class PaymentProviderService {
  constructor(private readonly config: ConfigService) {}

  resolveProvider(method: PaymentMethod, provider?: string): string {
    const requested = provider?.trim().toLowerCase();
    if (method === "CASH") return "cash";
    if (method === "WALLET") return "wallet";
    const configured = this.config.get<string>("payments.defaultProvider")?.trim().toLowerCase();
    const resolved = requested || configured;
    if (!resolved) throw new BadRequestException("No card payment provider is configured");
    return resolved;
  }

  async createCheckout(input: { paymentId: string; tripId: string; method: PaymentMethod; amount: number; currency: string; provider?: string; returnUrl?: string; cancelUrl?: string; idempotencyKey?: string; }): Promise<PaymentCheckoutResult> {
    const provider = this.resolveProvider(input.method, input.provider);
    if (input.method === "WALLET" || input.method === "CASH") {
      return { provider, providerPaymentId: `${provider}:${input.paymentId}`, providerStatus: input.method === "WALLET" ? "settled_internal" : "collect_on_completion", checkoutUrl: null, payload: { amount: input.amount, currency: input.currency } };
    }
    const result = await this.request("/payments", "POST", {
      internalPaymentId: input.paymentId, tripId: input.tripId, amount: input.amount,
      currency: input.currency, returnUrl: input.returnUrl, cancelUrl: input.cancelUrl,
    }, input.idempotencyKey ?? `checkout:${input.paymentId}`);
    return {
      provider,
      providerPaymentId: this.requiredString(result, "providerPaymentId", "paymentId", "id"),
      providerStatus: this.readString(result.status) ?? "pending",
      checkoutUrl: this.readString(result.checkoutUrl, result.url) ?? null,
      reference: this.readString(result.reference), payload: result,
    };
  }

  async capture(input: { paymentId: string; providerPaymentId?: string | null; provider: string; amount: number; currency: string; idempotencyKey: string; }): Promise<PaymentActionResult> {
    const payload = await this.request(`/payments/${encodeURIComponent(input.providerPaymentId ?? input.paymentId)}/capture`, "POST", { amount: input.amount, currency: input.currency }, input.idempotencyKey);
    return this.action(input.provider, payload, "captured");
  }

  async refund(input: { paymentId: string; providerPaymentId?: string | null; provider: string; amount: number; currency: string; idempotencyKey: string; reason?: string; }): Promise<PaymentActionResult> {
    const payload = await this.request(`/payments/${encodeURIComponent(input.providerPaymentId ?? input.paymentId)}/refunds`, "POST", { amount: input.amount, currency: input.currency, reason: input.reason }, input.idempotencyKey);
    return this.action(input.provider, payload, "refunded");
  }

  async cancel(input: { paymentId: string; providerPaymentId?: string | null; provider: string; idempotencyKey: string; }): Promise<PaymentActionResult> {
    const payload = await this.request(`/payments/${encodeURIComponent(input.providerPaymentId ?? input.paymentId)}/void`, "POST", {}, input.idempotencyKey);
    return this.action(input.provider, payload, "canceled");
  }

  verifyWebhook(rawBody: string, signature?: string): boolean {
    const secret = this.config.get<string>("payments.webhookSecret")?.trim();
    if (!secret || !signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const received = signature.replace(/^sha256=/, "").trim();
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }

  normalizeWebhook(provider: string, payload: Record<string, unknown>, eventId?: string): NormalizedWebhookEvent {
    const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata as Record<string, unknown> : {};
    const providerPaymentId = this.readString(payload.providerPaymentId, payload.paymentId, payload.provider_payment_id, payload.transactionId, payload.id);
    const internalPaymentId = this.readString(payload.internalPaymentId, payload.internal_payment_id, metadata.paymentId);
    const reference = this.readString(payload.reference, payload.orderId, payload.order_id);
    const providerStatus = this.readString(payload.status, payload.paymentStatus, payload.event, payload.type);
    const eventType = this.readString(payload.type, payload.event, providerStatus) ?? "provider_event";
    const reason = this.readString(payload.reason, payload.failureReason, payload.message);
    const idempotencyKey = eventId ?? this.readString(payload.idempotencyKey, payload.eventId, payload.event_id) ?? `${provider}:${providerPaymentId ?? internalPaymentId ?? reference ?? eventType}`;
    return { provider, eventType, providerPaymentId, internalPaymentId, reference, status: this.mapProviderStatus(providerStatus), providerStatus: providerStatus ?? eventType, reason, idempotencyKey, payload };
  }

  private async request(path: string, method: "POST", body: Record<string, unknown>, idempotencyKey: string): Promise<Record<string, unknown>> {
    const base = this.config.get<string>("payments.gatewayBaseUrl")?.replace(/\/+$/, "");
    const apiKey = this.config.get<string>("payments.apiKey")?.trim();
    if (!base || !apiKey) throw new BadRequestException("Payment gateway credentials are not configured");
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "idempotency-key": idempotencyKey }, body: JSON.stringify(body) });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new BadGatewayException({ message: "Payment provider request failed", providerStatus: response.status, payload });
    return payload;
  }
  private action(provider: string, payload: Record<string, unknown>, fallback: string): PaymentActionResult { return { provider, providerStatus: this.readString(payload.status) ?? fallback, reference: this.readString(payload.reference), statusReason: this.readString(payload.reason, payload.message), payload }; }
  private requiredString(payload: Record<string, unknown>, ...keys: string[]): string { const v=this.readString(...keys.map(k=>payload[k])); if(!v) throw new BadGatewayException("Provider response has no payment identifier"); return v; }
  private mapProviderStatus(value?: string): PaymentStatus | undefined { const n=value?.trim().toLowerCase(); if(!n)return undefined; if(["pending","created","initiated"].includes(n))return "PENDING"; if(["authorized","authorised","requires_capture"].includes(n))return "AUTHORIZED"; if(["captured","paid","succeeded","settled"].includes(n))return "CAPTURED"; if(["failed","declined","rejected"].includes(n))return "FAILED"; if(["refunded","refund"].includes(n))return "REFUNDED"; if(["canceled","cancelled","voided"].includes(n))return "CANCELED"; return undefined; }
  private readString(...values: unknown[]): string | undefined { for(const value of values) if(typeof value === "string" && value.trim()) return value.trim(); return undefined; }
}
