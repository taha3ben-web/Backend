import {
  canSettlementTransition,
  isTerminalSettlement,
  SETTLEMENT_TRANSITIONS,
} from "./settlement-transitions";

describe("settlement-transitions", () => {
  it("allows the happy path NOT_REQUIRED -> PENDING -> POSTED", () => {
    expect(canSettlementTransition("NOT_REQUIRED", "PENDING")).toBe(true);
    expect(canSettlementTransition("PENDING", "POSTED")).toBe(true);
  });

  it("allows retry from FAILED", () => {
    expect(canSettlementTransition("FAILED", "RETRYING")).toBe(true);
    expect(canSettlementTransition("FAILED", "POSTED")).toBe(true);
    expect(canSettlementTransition("RETRYING", "POSTED")).toBe(true);
  });

  it("treats POSTED as terminal and idempotent", () => {
    expect(isTerminalSettlement("POSTED")).toBe(true);
    expect(SETTLEMENT_TRANSITIONS.POSTED).toHaveLength(0);
    expect(canSettlementTransition("POSTED", "PENDING")).toBe(false);
    expect(canSettlementTransition("POSTED", "POSTED")).toBe(false);
  });

  it("rejects skipping straight from NOT_REQUIRED to POSTED", () => {
    expect(canSettlementTransition("NOT_REQUIRED", "POSTED")).toBe(false);
  });
});
