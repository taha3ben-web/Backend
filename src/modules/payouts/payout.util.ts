/**
 * منطق نقي لتسوية المدفوعات البنكية (payout batches) وتطبيع حالات بوّابة الدفع.
 * يعمل بوحدات صغرى (minor units) بأعداد صحيحة تجنّبًا لأخطاء الفاصلة العائمة.
 */

export type PayoutBatchStatus =
  "DRAFT" | "SUBMITTED" | "PROCESSING" | "PAID" | "FAILED" | "CANCELED";

const TRANSITIONS: Record<PayoutBatchStatus, PayoutBatchStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELED"],
  SUBMITTED: ["PROCESSING", "FAILED", "CANCELED"],
  PROCESSING: ["PAID", "FAILED"],
  PAID: [],
  FAILED: ["SUBMITTED"],
  CANCELED: [],
};

export function canTransition(
  from: PayoutBatchStatus,
  to: PayoutBatchStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: PayoutBatchStatus): boolean {
  return status === "PAID" || status === "CANCELED";
}

/** تحقّق مبسّط من صيغة IBAN (طول + أحرف/أرقام + رمز دولة). */
export function isValidIban(iban: string): boolean {
  if (typeof iban !== "string") return false;
  const cleaned = iban.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  if (!/^[A-Z]{2}[0-9A-Z]+$/.test(cleaned)) return false;
  return true;
}

export interface PayoutItemInput {
  amountMinor: number;
  currency: string;
}

export interface BatchTotals {
  count: number;
  totalMinor: number;
  currency: string;
}

/**
 * يجمع عناصر الدفعة ويتحقّق من وحدة العملة. يرمي خطأً عند اختلاط العملات.
 */
export function buildBatchTotals(items: PayoutItemInput[]): BatchTotals {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("EMPTY_BATCH");
  }
  const currency = items[0].currency;
  let totalMinor = 0;
  for (const it of items) {
    if (it.currency !== currency) {
      throw new Error("MIXED_CURRENCY");
    }
    if (!Number.isInteger(it.amountMinor) || it.amountMinor <= 0) {
      throw new Error("INVALID_AMOUNT");
    }
    totalMinor += it.amountMinor;
  }
  return { count: items.length, totalMinor, currency };
}

/** تطبيع حالة مزوّد الدفع الخام إلى حالة داخلية. */
export function normalizeProviderStatus(raw: string): PayoutBatchStatus {
  const s = (raw || "").toLowerCase();
  if (["paid", "completed", "success", "settled"].includes(s)) return "PAID";
  if (["failed", "rejected", "declined", "error"].includes(s)) return "FAILED";
  if (["processing", "pending", "in_progress"].includes(s)) return "PROCESSING";
  if (["submitted", "accepted", "queued"].includes(s)) return "SUBMITTED";
  if (["canceled", "cancelled", "voided"].includes(s)) return "CANCELED";
  return "PROCESSING";
}

export interface GatewayCapabilities {
  capture: boolean;
  refund: boolean;
  payout: boolean;
  webhookVerified: boolean;
}

const GATEWAY_CAPS: Record<string, GatewayCapabilities> = {
  manual: { capture: true, refund: true, payout: true, webhookVerified: false },
  stripe: { capture: true, refund: true, payout: true, webhookVerified: true },
  chargily: {
    capture: true,
    refund: false,
    payout: false,
    webhookVerified: true,
  },
  satim: { capture: true, refund: true, payout: false, webhookVerified: true },
};

export function gatewayCapabilities(provider: string): GatewayCapabilities {
  return (
    GATEWAY_CAPS[(provider || "").toLowerCase()] ?? {
      capture: true,
      refund: false,
      payout: false,
      webhookVerified: false,
    }
  );
}

/** مرجع دفعة حتمي وقابل للتتبّع (لا عشوائية). */
export function buildBatchReference(
  provider: string,
  yyyymmdd: string,
  seq: number,
): string {
  const p = (provider || "manual").toUpperCase().slice(0, 6);
  return `PO-${p}-${yyyymmdd}-${String(seq).padStart(4, "0")}`;
}
