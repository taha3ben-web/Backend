import type { PaymentStatus } from "@prisma/client";

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["AUTHORIZED", "CAPTURED", "PAID", "FAILED", "CANCELED"],
  AUTHORIZED: ["CAPTURED", "PAID", "FAILED", "CANCELED"],
  CAPTURED: ["REFUNDED"],
  PAID: ["REFUNDED"],
  FAILED: ["PENDING"],
  REFUNDED: [],
  CANCELED: [],
};

export function canPaymentTransition(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  return current === next || PAYMENT_TRANSITIONS[current].includes(next);
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}
