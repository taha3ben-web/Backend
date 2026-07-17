import {
  accountBalanceDifference,
  deriveAccountBalance,
  isReconciled,
} from "./reconciliation.util";

describe("reconciliation.util", () => {
  it("derives balance as credits minus debits", () => {
    expect(
      deriveAccountBalance([
        { direction: "CREDIT", amount: 100 },
        { direction: "DEBIT", amount: 30 },
        { direction: "CREDIT", amount: 5.5 },
      ]),
    ).toBe(75.5);
  });

  it("returns zero for no entries", () => {
    expect(deriveAccountBalance([])).toBe(0);
  });

  it("computes a signed difference both ways", () => {
    expect(accountBalanceDifference(100, 90)).toBe(10);
    expect(accountBalanceDifference(90, 100)).toBe(-10);
  });

  it("treats sub-cent drift as reconciled but real drift as a mismatch", () => {
    expect(isReconciled(100.001, 100)).toBe(true);
    expect(isReconciled(100.02, 100)).toBe(false);
  });
});
