import {
  canPaymentTransition,
  isTerminalPaymentStatus,
} from "./payment-transitions";

describe("payment transitions", () => {
  it("allows capture and refund only from eligible states", () => {
    expect(canPaymentTransition("AUTHORIZED", "CAPTURED")).toBe(true);
    expect(canPaymentTransition("CAPTURED", "REFUNDED")).toBe(true);
    expect(canPaymentTransition("PENDING", "REFUNDED")).toBe(false);
  });

  it("treats refunded and canceled as terminal", () => {
    expect(isTerminalPaymentStatus("REFUNDED")).toBe(true);
    expect(isTerminalPaymentStatus("CANCELED")).toBe(true);
    expect(isTerminalPaymentStatus("AUTHORIZED")).toBe(false);
  });
});
