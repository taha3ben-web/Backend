/**
 * منطق نقي لاتفاقيات مستوى الخدمة (SLA) للدعم: حساب المواعيد النهائية،
 * كشف التجاوز، مستويات التصعيد، ورموز الحلّ.
 */

export type TicketPriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

/** الزمن المستهدف للحلّ بالدقائق حسب الأولوية. */
export const SLA_MINUTES_BY_PRIORITY: Record<TicketPriority, number> = {
  URGENT: 60,
  HIGH: 240,
  NORMAL: 1440,
  LOW: 4320,
};

export const FIRST_RESPONSE_MINUTES_BY_PRIORITY: Record<
  TicketPriority,
  number
> = {
  URGENT: 15,
  HIGH: 60,
  NORMAL: 240,
  LOW: 720,
};

export const RESOLUTION_CODES = [
  "SOLVED",
  "DUPLICATE",
  "NOT_REPRODUCIBLE",
  "WONT_FIX",
  "USER_NO_RESPONSE",
  "REFUNDED",
  "ESCALATED_EXTERNAL",
] as const;

export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

const MINUTE_MS = 60_000;

export function isValidPriority(p: string): p is TicketPriority {
  return p in SLA_MINUTES_BY_PRIORITY;
}

export function isValidResolutionCode(code: string): code is ResolutionCode {
  return (RESOLUTION_CODES as readonly string[]).includes(code);
}

/** موعد الحلّ النهائي بالميلي ثانية. */
export function computeSlaDueAtMs(
  createdAtMs: number,
  priority: TicketPriority,
): number {
  return createdAtMs + SLA_MINUTES_BY_PRIORITY[priority] * MINUTE_MS;
}

/** موعد أوّل ردّ. */
export function computeFirstResponseDueAtMs(
  createdAtMs: number,
  priority: TicketPriority,
): number {
  return createdAtMs + FIRST_RESPONSE_MINUTES_BY_PRIORITY[priority] * MINUTE_MS;
}

/** هل تجاوزت التذكرة المهلة؟ (تُحتسب مغلقة عند وجود resolvedAt). */
export function isBreached(
  slaDueAtMs: number,
  nowMs: number,
  resolvedAtMs?: number | null,
): boolean {
  const effective = resolvedAtMs ?? nowMs;
  return effective > slaDueAtMs;
}

/** الوقت المتبقّي قبل التجاوز (سالب إذا تجاوزت). */
export function remainingSlaMs(slaDueAtMs: number, nowMs: number): number {
  return slaDueAtMs - nowMs;
}

/**
 * مستوى التصعيد بناءً على نسبة الوقت المنقضي من المهلة:
 * 0 = ضمن المهلة، 1 = >75%، 2 = تجاوز، 3 = تجاوز بأكثر من الضعف.
 */
export function escalationLevel(
  createdAtMs: number,
  nowMs: number,
  priority: TicketPriority,
): number {
  const budgetMs = SLA_MINUTES_BY_PRIORITY[priority] * MINUTE_MS;
  if (budgetMs <= 0) return 0;
  const elapsed = Math.max(0, nowMs - createdAtMs);
  const ratio = elapsed / budgetMs;
  if (ratio >= 2) return 3;
  if (ratio > 1) return 2;
  if (ratio >= 0.75) return 1;
  return 0;
}

/** ترتيب الأولوية للفرز (الأعلى إلحاحًا أوّلًا). */
export function priorityRank(priority: TicketPriority): number {
  const order: Record<TicketPriority, number> = {
    URGENT: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3,
  };
  return order[priority];
}
