import { Injectable } from "@nestjs/common";
import { FinancialService } from "../financial/financial.service";
import { OutboxService } from "../../common/infra/outbox.service";
import { RiskService } from "../risk/risk.service";
import { buildOpsHealth, OpsHealth } from "./ops-center.util";

/**
 * خدمة مركز العمليات (Operational Control Plane): توحّد لوحات تشغيلية
 * موزّعة في مؤشّر واحد: طابور التسوية، الوظائف الفاشلة (DLQ) + إعادة
 * محاولة، لوحات التطابق (reconciliation)، وطابور مراجعة المخاطر. تعتمد
 * على الخدمات القائمة (لا تكرّر المنطق) وتضيف طبقة تجميع + drill-down.
 */
@Injectable()
export class OpsCenterService {
  constructor(
    private readonly financial: FinancialService,
    private readonly outbox: OutboxService,
    private readonly risk: RiskService,
  ) {}

  /**
   * نظرة عامّة موحّدة: تجمع أعداد اللوحات الأربع بالتوازي ثم تشتقّ
   * حالة صحّية إجمالية (severity) للوحة التحكم.
   */
  async overview(): Promise<{
    health: OpsHealth;
    generatedAt: string;
  }> {
    const [
      pendingSettlements,
      failedSettlements,
      dlqStats,
      incidents,
      reviews,
    ] = await Promise.all([
      this.financial.settlementQueue(1, 1),
      this.financial.settlementQueue(1, 1, true),
      this.outbox.stats(),
      this.financial.listReconciliationIncidents(1, 1, "OPEN"),
      this.risk.listReviews("OPEN"),
    ]);

    const health = buildOpsHealth({
      pendingSettlements: pendingSettlements.total,
      failedSettlements: failedSettlements.total,
      deadLetters: dlqStats.DEAD ?? 0,
      openIncidents: incidents.total,
      openRiskReviews: Array.isArray(reviews) ? reviews.length : 0,
    });

    return { health, generatedAt: new Date().toISOString() };
  }

  // ----- طابور التسوية (drill-down) -----
  settlementQueue(
    page = 1,
    limit = 25,
    onlyFailed = false,
    search?: string,
    from?: string,
    to?: string,
  ) {
    return this.financial.settlementQueue(
      page,
      limit,
      onlyFailed,
      search,
      from,
      to,
    );
  }

  retrySettlements(
    limit = 25,
    onlyFailed = true,
    search?: string,
    from?: string,
    to?: string,
  ) {
    return this.financial.runSettlementBatch(
      limit,
      onlyFailed,
      search,
      from,
      to,
    );
  }

  // ----- الوظائف الفاشلة / DLQ -----
  async deadLetters(limit = 100) {
    const [stats, items] = await Promise.all([
      this.outbox.stats(),
      this.outbox.listDeadLetters(limit),
    ]);
    return { stats, items };
  }

  async retryDeadLetter(id: string) {
    await this.outbox.retryDeadLetter(id);
    return { id, status: "REQUEUED" };
  }

  // ----- لوحة التطابق (reconciliation) -----
  incidents(
    page = 1,
    limit = 25,
    status?: "OPEN" | "RESOLVED" | "IGNORED",
  ) {
    return this.financial.listReconciliationIncidents(page, limit, status);
  }

  resolveIncident(
    id: string,
    resolvedBy: string,
    status: "RESOLVED" | "IGNORED" = "RESOLVED",
  ) {
    return this.financial.resolveReconciliationIncident(id, resolvedBy, status);
  }

  runReconciliation() {
    return this.financial.reconcileLedgerBalances();
  }

  // ----- طابور مراجعة المخاطر -----
  riskReviews(status: "OPEN" | "APPROVED" | "REJECTED" = "OPEN") {
    return this.risk.listReviews(status);
  }
}
