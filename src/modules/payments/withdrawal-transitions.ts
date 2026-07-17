// آلة حالات مستقلة عن Prisma لتبقى قابلة للاختبار دون قاعدة بيانات.
// القيم مطابقة لـ WithdrawStatus في schema.prisma.
export type WithdrawalStatus = "PENDING" | "APPROVED" | "PAID" | "REJECTED";

/**
 * مسار السحب المسموح:
 * - PENDING -> APPROVED -> PAID
 * - PENDING -> REJECTED
 * PAID وREJECTED حالتان نهائيتان.
 */
export const WITHDRAWAL_TRANSITIONS: Record<
  WithdrawalStatus,
  WithdrawalStatus[]
> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["PAID"],
  PAID: [],
  REJECTED: [],
};

export function canWithdrawalTransition(
  from: WithdrawalStatus,
  to: WithdrawalStatus,
): boolean {
  return WITHDRAWAL_TRANSITIONS[from].includes(to);
}

export function isTerminalWithdrawal(status: WithdrawalStatus): boolean {
  return WITHDRAWAL_TRANSITIONS[status].length === 0;
}
