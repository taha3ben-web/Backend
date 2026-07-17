import {
  canWithdrawalTransition,
  isTerminalWithdrawal,
  WITHDRAWAL_TRANSITIONS,
} from "./withdrawal-transitions";

describe("withdrawal-transitions", () => {
  it("allows the approved payout path", () => {
    expect(canWithdrawalTransition("PENDING", "APPROVED")).toBe(true);
    expect(canWithdrawalTransition("APPROVED", "PAID")).toBe(true);
  });

  it("allows rejecting only a pending request", () => {
    expect(canWithdrawalTransition("PENDING", "REJECTED")).toBe(true);
    expect(canWithdrawalTransition("APPROVED", "REJECTED")).toBe(false);
  });

  it("prevents paying a request before approval", () => {
    expect(canWithdrawalTransition("PENDING", "PAID")).toBe(false);
  });

  it("makes PAID and REJECTED terminal", () => {
    expect(isTerminalWithdrawal("PAID")).toBe(true);
    expect(isTerminalWithdrawal("REJECTED")).toBe(true);
    expect(WITHDRAWAL_TRANSITIONS.PAID).toHaveLength(0);
    expect(WITHDRAWAL_TRANSITIONS.REJECTED).toHaveLength(0);
  });
});
