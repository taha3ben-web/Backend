import { BadRequestException, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "@prisma/client";
import {
  ActionInput,
  CancelInput,
  CheckoutInput,
  PaymentActionResult,
  PaymentAdapter,
  PaymentCheckoutResult,
} from "./payment-adapter";

/**
 * \u0645\u062d\u0648\u0651\u0644 Chargily Pay v2 (\u0628\u0637\u0627\u0642\u0627\u062a CIB / EDAHABIA).
 *
 * \u0642\u0631\u0627\u0631\u0627\u062a \u0645\u0642\u0635\u0648\u062f\u0629:
 * - \u0628\u0644\u0627 SDK: \u0646\u062f\u0627\u0621\u0627\u062a `fetch` \u0645\u0628\u0627\u0634\u0631\u0629 \u0644\u0640 REST API. \u0623\u0642\u0644 \u062a\u0628\u0639\u064a\u0629\u060c \u0648\u0644\u0627 \u062d\u0632\u0645\u0629 \u062a\u062a\u0639\u0637\u0644 \u0645\u0639 \u062a\u062d\u062f\u064a\u062b Node.
 * - Chargily \u062a\u064f\u062d\u0635\u0651\u0644 \u0627\u0644\u0645\u0628\u0644\u063a \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627 \u0639\u0646\u062f \u0646\u062c\u0627\u062d \u0627\u0644\u062f\u0641\u0639\u061b \u0644\u0627 \u064a\u0648\u062c\u062f authorize/capture
 *   \u0645\u0646\u0641\u0635\u0644\u0627\u0646\u060c \u0644\u0630\u0644\u0643 `capture` \u064a\u0642\u0631\u0623 \u062d\u0627\u0644\u0629 \u0627\u0644\u062f\u0641\u0639\u0629 \u0627\u0644\u062d\u0642\u064a\u0642\u064a\u0629 \u0645\u0646 \u0627\u0644\u0645\u0632\u0648\u0651\u062f \u0648\u064a\u0631\u0641\u0636
 *   \u0625\u0646 \u0644\u0645 \u062a\u0643\u0646 `paid` \u2014 \u0644\u0627 \u0646\u062c\u0627\u062d \u0648\u0647\u0645\u064a.
 * - \u0644\u0627 \u062a\u0648\u0641\u0631 Chargily API \u0644\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f\u061b \u0644\u0630\u0644\u0643 `refund` \u064a\u0631\u0645\u064a \u062e\u0637\u0623\u064b \u0635\u0631\u064a\u062d\u064b\u0627
 *   \u064a\u0648\u062c\u0651\u0647 \u0644\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0625\u0644\u0649 \u0645\u062d\u0641\u0638\u0629 \u0627\u0644\u0631\u0627\u0643\u0628 (\u062d\u0631\u0643\u0629 \u062f\u0627\u062e\u0644\u064a\u0629 \u0645\u0648\u062b\u0651\u0642\u0629 \u0641\u064a \u0627\u0644\u062f\u0641\u062a\u0631).
 */

export const CHARGILY_LIVE_BASE_URL = "https://pay.chargily.net/api/v2";
export const CHARGILY_TEST_BASE_URL = "https://pay.chargily.net/test/api/v2";
export const CHARGILY_TIMEOUT_MS = 15_000;

export type ChargilyPaymentMethod = "edahabia" | "cib";

export interface ChargilyConfig {
  secretKey: string;
  baseUrl: string;
  defaultMethod: ChargilyPaymentMethod;
  webhookUrl?: string;
  successUrl?: string;
  failureUrl?: string;
  locale: string;
}

/**
 * \u064a\u0642\u0631\u0623 \u0627\u0644\u0625\u0639\u062f\u0627\u062f \u0645\u0646 \u0627\u0644\u0628\u064a\u0626\u0629. \u064a\u064f\u0631\u062c\u0639 `null` \u0625\u0646 \u0644\u0645 \u064a\u064f\u0636\u0628\u0637 \u0627\u0644\u0645\u0641\u062a\u0627\u062d \u0627\u0644\u0633\u0631\u0651\u064a\u060c
 * \u0641\u064a\u0628\u0642\u0649 \u0627\u0644\u0645\u0632\u0648\u0651\u062f \u063a\u064a\u0631 \u0645\u0633\u062c\u0651\u0644 \u0628\u062f\u0644 \u0623\u0646 \u064a\u0641\u0634\u0644 \u0648\u0642\u062a \u0627\u0644\u062a\u0634\u063a\u064a\u0644.
 */
export function readChargilyConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChargilyConfig | null {
  const secretKey = env.CHARGILY_SECRET_KEY?.trim();
  if (!secretKey) return null;
  const mode = env.CHARGILY_MODE?.trim().toLowerCase();
  const baseUrl = (
    env.CHARGILY_BASE_URL?.trim() ||
    (mode === "live" ? CHARGILY_LIVE_BASE_URL : CHARGILY_TEST_BASE_URL)
  ).replace(/\/+$/, "");
  const method = env.CHARGILY_DEFAULT_METHOD?.trim().toLowerCase();
  return {
    secretKey,
    baseUrl,
    defaultMethod: method === "cib" ? "cib" : "edahabia",
    webhookUrl: env.CHARGILY_WEBHOOK_URL?.trim() || undefined,
    successUrl: env.CHARGILY_SUCCESS_URL?.trim() || undefined,
    failureUrl: env.CHARGILY_FAILURE_URL?.trim() || undefined,
    locale: env.CHARGILY_LOCALE?.trim() || "ar",
  };
}

/**
 * \u062a\u062d\u0642\u0642 \u062a\u0648\u0642\u064a\u0639 webhook \u0645\u0646 Chargily: HMAC-SHA256 \u0628\u0627\u0644\u0645\u0641\u062a\u0627\u062d \u0627\u0644\u0633\u0631\u0651\u064a
 * \u0645\u062d\u0633\u0648\u0628 \u0639\u0644\u0649 **\u0627\u0644\u0628\u0627\u064a\u062a\u0627\u062a \u0627\u0644\u062e\u0627\u0645** \u0648\u0645\u064f\u0631\u0633\u0644 \u0641\u064a \u062a\u0631\u0648\u064a\u0633\u0629 `signature` (hex).
 * \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0629 \u062b\u0627\u0628\u062a\u0629 \u0627\u0644\u0632\u0645\u0646.
 */
export function verifyChargilySignature(args: {
  secretKey: string;
  rawBody: Buffer;
  signature?: string;
}): boolean {
  const provided = args.signature?.trim();
  if (!provided || !args.rawBody?.length) return false;
  if (!/^[0-9a-f]+$/i.test(provided)) return false;
  const expected = createHmac("sha256", args.secretKey)
    .update(args.rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** \u062a\u062d\u0648\u064a\u0644 \u062d\u0627\u0644\u0627\u062a/\u0623\u062d\u062f\u0627\u062b Chargily \u0625\u0644\u0649 \u062d\u0627\u0644\u0627\u062a \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u062f\u0627\u062e\u0644\u064a\u0629. */
export function mapChargilyStatus(value?: string): PaymentStatus | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^checkout\./, "");
  if (!normalized) return undefined;
  switch (normalized) {
    case "pending":
    case "processing":
      return "PENDING";
    case "paid":
      return "CAPTURED";
    case "failed":
      return "FAILED";
    case "canceled":
    case "cancelled":
    case "expired":
      return "CANCELED";
    default:
      return undefined;
  }
}

export class ChargilyPaymentAdapter implements PaymentAdapter {
  readonly name = "chargily";
  readonly redirectBased = true;
  private readonly logger = new Logger(ChargilyPaymentAdapter.name);

  constructor(private readonly config: ChargilyConfig) {}

  async createCheckout(input: CheckoutInput): Promise<PaymentCheckoutResult> {
    const currency = input.currency.trim().toLowerCase();
    if (currency !== "dzd") {
      throw new BadRequestException("CHARGILY_CURRENCY_UNSUPPORTED");
    }
    const amount = Math.round(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException("CHARGILY_INVALID_AMOUNT");
    }

    const body: Record<string, unknown> = {
      amount,
      currency,
      payment_method: this.config.defaultMethod,
      locale: this.config.locale,
      description: `flaminGO trip ${input.tripId}`,
      metadata: {
        paymentId: input.paymentId,
        tripId: input.tripId,
      },
    };
    const successUrl = input.returnUrl ?? this.config.successUrl;
    const failureUrl = input.cancelUrl ?? this.config.failureUrl;
    if (successUrl) body.success_url = successUrl;
    if (failureUrl) body.failure_url = failureUrl;
    if (this.config.webhookUrl) body.webhook_endpoint = this.config.webhookUrl;

    const payload = await this.request("POST", "/checkouts", body);
    const providerPaymentId = readString(payload.id, payload.checkout_id);
    const checkoutUrl = readString(payload.checkout_url, payload.url) ?? null;
    if (!providerPaymentId || !checkoutUrl) {
      throw new BadRequestException("CHARGILY_CHECKOUT_INCOMPLETE");
    }
    return {
      provider: this.name,
      providerPaymentId,
      providerStatus: readString(payload.status) ?? "pending",
      reference: readString(payload.invoice_id, payload.id),
      checkoutUrl,
      payload,
    };
  }

  /**
   * Chargily \u062a\u064f\u062d\u0635\u0651\u0644 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627\u061b \u0641\u0647\u0646\u0627 \u0646\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u062d\u0642\u064a\u0642\u064a\u0629 \u0644\u062f\u0649 \u0627\u0644\u0645\u0632\u0648\u0651\u062f
   * \u0642\u0628\u0644 \u0627\u0644\u0633\u0645\u0627\u062d \u0644\u0644\u062f\u0641\u062a\u0631 \u0627\u0644\u0645\u0627\u0644\u064a \u0628\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062a\u062d\u0635\u064a\u0644.
   */
  async capture(input: ActionInput): Promise<PaymentActionResult> {
    const payload = await this.request(
      "GET",
      `/checkouts/${encodeURIComponent(input.paymentId)}`,
    );
    const status = readString(payload.status)?.toLowerCase();
    if (status !== "paid") {
      throw new BadRequestException(
        `CHARGILY_NOT_PAID_${(status ?? "unknown").toUpperCase()}`,
      );
    }
    return {
      provider: this.name,
      providerStatus: "paid",
      reference: readString(payload.invoice_id, payload.id),
      payload,
    };
  }

  async refund(_input: ActionInput): Promise<PaymentActionResult> {
    // \u0644\u0627 \u064a\u0648\u062c\u062f endpoint \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0641\u064a Chargily Pay v2.
    throw new BadRequestException("CHARGILY_REFUND_NOT_SUPPORTED");
  }

  /**
   * \u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u0644\u063a\u0627\u0621 checkout \u0645\u0646 \u062e\u0627\u0631\u062c \u0648\u0627\u062c\u0647\u0629 Chargily\u060c \u0644\u0643\u0646 \u0627\u0644\u0625\u0644\u063a\u0627\u0621 \u0642\u0628\u0644
   * \u0627\u0644\u062f\u0641\u0639 \u0623\u0645\u0631 \u0645\u0634\u0631\u0648\u0639: \u0646\u062a\u062d\u0642\u0642 \u0623\u0646\u0651 \u0627\u0644\u062d\u0627\u0644\u0629 \u0644\u064a\u0633\u062a `paid` \u062d\u062a\u0649 \u0644\u0627 \u0646\u064f\u0644\u063a\u064a \u062f\u0641\u0639\u0629 \u0645\u062f\u0641\u0648\u0639\u0629.
   */
  async cancel(input: CancelInput): Promise<PaymentActionResult> {
    const payload = await this.request(
      "GET",
      `/checkouts/${encodeURIComponent(input.paymentId)}`,
    );
    const status = readString(payload.status)?.toLowerCase();
    if (status === "paid") {
      throw new BadRequestException("CHARGILY_ALREADY_PAID");
    }
    return {
      provider: this.name,
      providerStatus: status ?? "canceled",
      payload,
    };
  }

  /** \u0646\u062f\u0627\u0621 HTTP \u0645\u0648\u062d\u0651\u062f \u0645\u0639 \u0645\u0647\u0644\u0629 \u0632\u0645\u0646\u064a\u0629 \u0648\u0631\u0633\u0627\u0644\u0629 \u062e\u0637\u0623 \u0644\u0627 \u062a\u0643\u0634\u0641 \u0627\u0644\u0645\u0641\u062a\u0627\u062d. */
  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHARGILY_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      if (text) {
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch {
          parsed = { raw: text };
        }
      }
      if (!response.ok) {
        this.logger.warn(
          `Chargily ${method} ${path} failed with ${response.status}`,
        );
        throw new BadRequestException(`CHARGILY_HTTP_${response.status}`);
      }
      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const reason = error instanceof Error ? error.name : "unknown";
      this.logger.error(`Chargily ${method} ${path} error: ${reason}`);
      throw new BadRequestException("CHARGILY_UNREACHABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
