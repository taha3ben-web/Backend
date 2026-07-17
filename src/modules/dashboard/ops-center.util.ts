/**
 * طبقة نقية لمركز العمليات (Operational Control Plane) — تحول الأعداد الخام
 * إلى درجات خطورة (severity) وحالة صحّية إجمالية، بلا اعتماد على DB.
 * تُستهلك من `OpsCenterService` لتوحيد لوحات التسوية/الوظائف الفاشلة/
 * التطابق/المخاطر في مؤشّر واحد قابل للتدرّج (drill-down).
 */

export type OpsSeverity = "OK" | "WARN" | "CRITICAL";

const RANK: Record<OpsSeverity, number> = { OK: 0, WARN: 1, CRITICAL: 2 };

/** عتبة عامة: تحول عددًا إلى خطورة بمقارنته بعتبتي تحذير/حرج. */
export function thresholdSeverity(
  count: number,
  warnAt: number,
  criticalAt: number,
): OpsSeverity {
  if (count >= criticalAt) return "CRITICAL";
  if (count >= warnAt) return "WARN";
  return "OK";
}

/** أسوأ خطورة ضمن مجموعة (للحالة الإجمالية). */
export function rollupSeverity(severities: OpsSeverity[]): OpsSeverity {
  let worst: OpsSeverity = "OK";
  for (const s of severities) {
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

export interface OpsCounters {
  /** رحلات مكتملة بلا تسوية بعد. */
  pendingSettlements: number;
  /** رحلات تسويتها فشلت (settlementError موجود). */
  failedSettlements: number;
  /** أحداث في طابور الرسائل الميتة (DLQ). */
  deadLetters: number;
  /** حوادث تطابق مفتوحة. */
  openIncidents: number;
  /** عناصر مراجعة مخاطر مفتوحة. */
  openRiskReviews: number;
}

export interface OpsPanel {
  key: string;
  severity: OpsSeverity;
  metrics: Record<string, number>;
}

export interface OpsHealth {
  severity: OpsSeverity;
  panels: OpsPanel[];
}

/**
 * يبني الحالة الصحّية لمركز العمليات من الأعداد الخام. الوظائف الفاشلة
 * (settlement errors و DLQ) وحوادث التطابق ترفع الخطورة أسرع، لأنّها
 * تمسّ سلامة الأموال مباشرةً.
 */
export function buildOpsHealth(c: OpsCounters): OpsHealth {
  const panels: OpsPanel[] = [
    {
      key: "settlement",
      severity: rollupSeverity([
        thresholdSeverity(c.pendingSettlements, 25, 100),
        thresholdSeverity(c.failedSettlements, 1, 10),
      ]),
      metrics: {
        pending: c.pendingSettlements,
        failed: c.failedSettlements,
      },
    },
    {
      key: "deadLetters",
      severity: thresholdSeverity(c.deadLetters, 1, 20),
      metrics: { dead: c.deadLetters },
    },
    {
      key: "reconciliation",
      severity: thresholdSeverity(c.openIncidents, 1, 5),
      metrics: { openIncidents: c.openIncidents },
    },
    {
      key: "risk",
      severity: thresholdSeverity(c.openRiskReviews, 10, 50),
      metrics: { openReviews: c.openRiskReviews },
    },
  ];

  return {
    severity: rollupSeverity(panels.map((p) => p.severity)),
    panels,
  };
}
