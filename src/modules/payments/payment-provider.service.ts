import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PaymentMethod, PaymentStatus } from "@prisma/client";
import {
  ActionInput,
  CancelInput,
  CashPaymentAdapter,
  CheckoutInput,
  PaymentActionResult,
  PaymentAdapter,
  PaymentCheckoutResult,
  WalletPaymentAdapter,
} from "./providers/payment-adapter";

// إعادة تصدير الأنواع للحفاظ على مسارات الاستيراد الحالية.
export type {
  NormalizedWebhookEvent,
  PaymentActionResult,
  PaymentAdapter,
  PaymentCheckoutResult,
} from "./providers/payment-adapter";
import type { NormalizedWebhookEvent } from "./providers/payment-adapter";
import {
  ChargilyPaymentAdapter,
  mapChargilyStatus,
  readChargilyConfig,
} from "./providers/chargily.adapter";

/**
 * سجل مزوّدي الدفع.
 *
 * المُفعّل حاليًا: نقدًا + محفظة فقط (قرار تشغيلي).
 * أي مزوّد بطاقات (مثل Chargily) يُضاف هنا عندما يكتمل محوّله ويُختبر.
 *
 * قاعدة حاكمة: **لا نجاح وهمي**. المزوّد غير المسجل يرمي خطأً، ولا يُرجع أبدًا
 * أن المبلغ تمّ تحصيله أو استرداده دون حركة مال حقيقية، لأن ذلك يُدخل الدفتر
 * المالي في اختلال لا يُكتشف إلا عند التسوية مع البنك.
 */
@Injectable()
export class PaymentProviderService {
  private readonly adapters = new Map<string, PaymentAdapter>(
    [new CashPaymentAdapter(), new WalletPaymentAdapter()].map((adapter) => [
      adapter.name,
      adapter,
    ]),
  );

  private readonly logger = new Logger(PaymentProviderService.name);

  constructor() {
    // يُسجّل محوّل البطاقات فقط إن كان مضبوطًا فعليًا في البيئة.
    const chargily = readChargilyConfig();
    if (chargily) {
      this.register(new ChargilyPaymentAdapter(chargily));
      const mode = chargily.baseUrl.includes("/test/") ? "test" : "live";
      this.logger.log(`Chargily payment adapter enabled (${mode})`);
    }
  }

  /** أسماء المزوّدين المُفعّلين فعليًا (للوحة وللتشخيص). */
  get enabledProviders(): string[] {
    return [...this.adapters.keys()];
  }

  /** تسجيل محوّل جديد (نقطة التوسعة لـ Chargily مستقبلاً). */
  register(adapter: PaymentAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  resolveProvider(method: PaymentMethod, provider?: string): string {
    const normalized = provider?.trim().toLowerCase();
    if (normalized) return normalized;
    switch (method) {
      case "CARD":
        if (this.adapters.has("chargily")) return "chargily";
        throw new BadRequestException("No card payment provider is configured");
      case "WALLET":
        return "wallet";
      case "CASH":
      default:
        return "cash";
    }
  }

  /** يجلب المحوّل أو يرمي خطأً واضحًا — لا افتراضات صامتة. */
  private adapterFor(provider: string): PaymentAdapter {
    const adapter = this.adapters.get(provider.trim().toLowerCase());
    if (!adapter) {
      throw new BadRequestException(
        `Payment provider ${provider} has no active adapter`,
      );
    }
    return adapter;
  }

  async createCheckout(input: CheckoutInput): Promise<PaymentCheckoutResult> {
    const provider = this.resolveProvider(input.method, input.provider);
    return this.adapterFor(provider).createCheckout(input);
  }

  async capture(input: ActionInput): Promise<PaymentActionResult> {
    return this.adapterFor(input.provider).capture(input);
  }

  async refund(input: ActionInput): Promise<PaymentActionResult> {
    return this.adapterFor(input.provider).refund(input);
  }

  async cancel(input: CancelInput): Promise<PaymentActionResult> {
    return this.adapterFor(input.provider).cancel(input);
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
      this.readString(payload.type, payload.event, providerStatus) ??
      "provider_event";
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
    // أحداث Chargily تأتي بصيغة `checkout.paid` وما شابهها.
    const chargilyMapped = mapChargilyStatus(value);
    if (chargilyMapped) return chargilyMapped;
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
