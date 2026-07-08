import type { TripStatus } from "./trip-transitions";
import { canTransition, TRANSITIONS } from "./trip-transitions";

// مساعد لتحويل نص إلى نوع TripStatus دون الاعتماد على قيمة enum وقت التشغيل.
const S = (v: string): TripStatus => v as TripStatus;

describe("trip transitions", () => {
  it("allows the happy-path lifecycle", () => {
    expect(canTransition(S("SEARCHING"), S("ACCEPTED"))).toBe(true);
    expect(canTransition(S("ACCEPTED"), S("ARRIVING"))).toBe(true);
    expect(canTransition(S("ARRIVING"), S("IN_PROGRESS"))).toBe(true);
    expect(canTransition(S("IN_PROGRESS"), S("COMPLETED"))).toBe(true);
  });

  it("allows cancellation from every active state", () => {
    for (const from of ["SEARCHING", "ACCEPTED", "ARRIVING", "IN_PROGRESS"]) {
      expect(canTransition(S(from), S("CANCELLED"))).toBe(true);
    }
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(canTransition(S("COMPLETED"), S("ACCEPTED"))).toBe(false);
    expect(canTransition(S("CANCELLED"), S("SEARCHING"))).toBe(false);
  });

  it("forbids skipping steps", () => {
    expect(canTransition(S("SEARCHING"), S("IN_PROGRESS"))).toBe(false);
    expect(canTransition(S("ACCEPTED"), S("COMPLETED"))).toBe(false);
    expect(canTransition(S("SEARCHING"), S("COMPLETED"))).toBe(false);
  });

  it("forbids reviving or re-completing a trip", () => {
    expect(canTransition(S("COMPLETED"), S("COMPLETED"))).toBe(false);
    expect(canTransition(S("IN_PROGRESS"), S("SEARCHING"))).toBe(false);
  });
});
