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

export interface CheckoutInput {
  paymentId: string;
  tripId: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
  provider?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface ActionInput {
  paymentId: string;
  provider: string;
  amount: number;
  currency: string;
}

export interface CancelInput {
  paymentId: string;
  provider: string;
}

/**
 * عقد محوّل الدفع الموحّد.
 *
 * كل وسيلة دفع (نقدًا، محفظة، بوابة بطاقات) تُنفّذ هذا العقد، والطبقة المالية
 * لا تعرف أي شيء عن تفاصيل المزوّد. إضافة مزوّد جديد = ملف واحد + تسجيله.
 */
export interface PaymentAdapter {
  readonly name: string;
  /** هل يحتاج الراكب إلى فتح صفحة دفع خارجية؟ */
  readonly redirectBased: boolean;
  createCheckout(input: CheckoutInput): Promise<PaymentCheckoutResult>;
  capture(input: ActionInput): Promise<PaymentActionResult>;
  refund(input: ActionInput): Promise<PaymentActionResult>;
  cancel(input: CancelInput): Promise<PaymentActionResult>;
}

/**
 * محوّل الدفع نقدًا: لا حركة مال إلكترونية، التحصيل يدوي عند نهاية الرحلة،
 * والتسوية تجري في دفتر الأستاذ (`PLATFORM:CASH_CLEARING`).
 */
export class CashPaymentAdapter implements PaymentAdapter {
  readonly name = "cash";
  readonly redirectBased = false;

  async createCheckout(input: CheckoutInput): Promise<PaymentCheckoutResult> {
    return {
      provider: this.name,
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

  async capture(input: ActionInput): Promise<PaymentActionResult> {
    return this.action("capture", input.paymentId, "collected_in_cash", {
      amount: input.amount,
      currency: input.currency,
    });
  }

  async refund(input: ActionInput): Promise<PaymentActionResult> {
    // الاسترداد النقدي يجري داخليًا (محفظة الراكب) وليس عبر بوابة خارجية.
    return this.action("refund", input.paymentId, "refunded_to_wallet", {
      amount: input.amount,
      currency: input.currency,
    });
  }

  async cancel(input: CancelInput): Promise<PaymentActionResult> {
    return this.action("cancel", input.paymentId, "canceled", {});
  }

  private action(
    action: string,
    paymentId: string,
    providerStatus: string,
    extra: Record<string, unknown>,
  ): PaymentActionResult {
    return {
      provider: this.name,
      providerStatus,
      payload: { action, paymentId, ...extra },
    };
  }
}

/**
 * محوّل الدفع من المحفظة: المال داخلي بالكامل، والرصيد يُتحقق منه
 * ويُحجز في دفتر الأستاذ (LOCKED) وليس هنا — هذا المحوّل وصفي فقط.
 */
export class WalletPaymentAdapter implements PaymentAdapter {
  readonly name = "wallet";
  readonly redirectBased = false;

  async createCheckout(input: CheckoutInput): Promise<PaymentCheckoutResult> {
    return {
      provider: this.name,
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

  async capture(input: ActionInput): Promise<PaymentActionResult> {
    return {
      provider: this.name,
      providerStatus: "captured_from_balance",
      payload: {
        action: "capture",
        paymentId: input.paymentId,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }

  async refund(input: ActionInput): Promise<PaymentActionResult> {
    return {
      provider: this.name,
      providerStatus: "refunded_to_balance",
      payload: {
        action: "refund",
        paymentId: input.paymentId,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }

  async cancel(input: CancelInput): Promise<PaymentActionResult> {
    return {
      provider: this.name,
      providerStatus: "canceled",
      payload: { action: "cancel", paymentId: input.paymentId },
    };
  }
}
