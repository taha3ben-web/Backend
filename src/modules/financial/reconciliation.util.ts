export interface ReconLine {
  direction: "DEBIT" | "CREDIT";
  amount: number;
}

/**
 * Ledger-derived balance for an account: Σ CREDIT − Σ DEBIT.
 * Mirrors the balanceCache update convention used in FinancialService.post().
 */
export function deriveAccountBalance(lines: ReconLine[]): number {
  const total = lines.reduce(
    (sum, line) =>
      sum + (line.direction === "CREDIT" ? line.amount : -line.amount),
    0,
  );
  return Number(total.toFixed(2));
}

/** Signed drift between the cached balance and the ledger-derived balance. */
export function accountBalanceDifference(
  cached: number,
  derived: number,
): number {
  return Number((cached - derived).toFixed(2));
}

/** True when the cached balance matches the ledger within tolerance. */
export function isReconciled(
  cached: number,
  derived: number,
  tolerance = 0.005,
): boolean {
  return Math.abs(accountBalanceDifference(cached, derived)) <= tolerance;
}
