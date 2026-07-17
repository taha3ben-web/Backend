import {
  computeSlaDueAtMs,
  computeFirstResponseDueAtMs,
  isBreached,
  remainingSlaMs,
  escalationLevel,
  isValidPriority,
  isValidResolutionCode,
  priorityRank,
  SLA_MINUTES_BY_PRIORITY,
} from "./support-sla.util";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe("support-sla.util", () => {
  it("validates priorities and resolution codes", () => {
    expect(isValidPriority("URGENT")).toBe(true);
    expect(isValidPriority("BOGUS")).toBe(false);
    expect(isValidResolutionCode("SOLVED")).toBe(true);
    expect(isValidResolutionCode("NOPE")).toBe(false);
  });

  it("computes SLA due dates by priority", () => {
    expect(computeSlaDueAtMs(NOW, "URGENT")).toBe(
      NOW + SLA_MINUTES_BY_PRIORITY.URGENT * MIN,
    );
    expect(computeFirstResponseDueAtMs(NOW, "URGENT")).toBe(NOW + 15 * MIN);
  });

  it("detects breaches", () => {
    const due = computeSlaDueAtMs(NOW, "URGENT");
    expect(isBreached(due, due + 1)).toBe(true);
    expect(isBreached(due, due - 1)).toBe(false);
  });

  it("treats resolved-before-due as not breached", () => {
    const due = computeSlaDueAtMs(NOW, "HIGH");
    expect(isBreached(due, due + 10 * MIN, due - 5 * MIN)).toBe(false);
  });

  it("reports remaining time", () => {
    const due = NOW + 30 * MIN;
    expect(remainingSlaMs(due, NOW)).toBe(30 * MIN);
  });

  it("escalates by elapsed ratio", () => {
    const budget = SLA_MINUTES_BY_PRIORITY.URGENT; // 60 min
    expect(escalationLevel(NOW, NOW + 10 * MIN, "URGENT")).toBe(0);
    expect(escalationLevel(NOW, NOW + 50 * MIN, "URGENT")).toBe(1);
    expect(escalationLevel(NOW, NOW + (budget + 5) * MIN, "URGENT")).toBe(2);
    expect(escalationLevel(NOW, NOW + budget * 2 * MIN, "URGENT")).toBe(3);
  });

  it("ranks priorities", () => {
    expect(priorityRank("URGENT")).toBeLessThan(priorityRank("LOW"));
  });
});
