import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { FinancialService } from "./financial.service";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("financial")
export class FinancialController {
  constructor(private readonly financial: FinancialService) {}

  @RequirePermissions("payments.read", "reports.read")
  @Get("accounts")
  accounts(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
  ) {
    return this.financial.listAccounts(
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      search,
    );
  }

  @RequirePermissions("payments.read", "reports.read")
  @Get("transactions")
  transactions(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("status") status?: "PENDING" | "POSTED" | "FAILED" | "REVERSED" | "CANCELLED",
    @Query("referenceType") referenceType?: string,
    @Query("search") search?: string,
  ) {
    return this.financial.listTransactions(
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      status,
      referenceType,
      search,
    );
  }

  @RequirePermissions("payments.read", "reports.read")
  @Get("reconciliation/summary")
  reconciliationSummary(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.financial.reconciliationSummary(from, to);
  }

  @RequirePermissions("payments.read", "reports.read")
  @Get("reconciliation/incidents")
  reconciliationIncidents(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("status") status?: "OPEN" | "RESOLVED" | "IGNORED",
  ) {
    return this.financial.listReconciliationIncidents(
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      status,
    );
  }

  @RequirePermissions("payments.manage")
  @Post("reconciliation/run")
  runReconciliation() {
    return this.financial.reconcileLedgerBalances();
  }

  @RequirePermissions("payments.manage")
  @Post("reconciliation/incidents/resolve")
  resolveReconciliationIncident(
    @CurrentUser() user: AuthUser,
    @Body() dto: { id: string; status?: "RESOLVED" | "IGNORED" },
  ) {
    return this.financial.resolveReconciliationIncident(
      dto.id,
      user.userId,
      dto.status ?? "RESOLVED",
    );
  }

  @RequirePermissions("payments.read", "reports.read")
  @Get("reconciliation/items")
  reconciliationItems(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("type") type?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.financial.reconciliationItems(
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      type,
      search,
      from,
      to,
    );
  }

  @RequirePermissions("payments.read", "payments.manage")
  @Get("settlement/queue")
  settlementQueue(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("onlyFailed") onlyFailed?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.financial.settlementQueue(
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
      onlyFailed === "true",
      search,
      from,
      to,
    );
  }

  @RequirePermissions("payments.manage")
  @Post("settlement/run")
  runSettlement(
    @Body()
    body?: {
      limit?: number;
      onlyFailed?: boolean;
      search?: string;
      from?: string;
      to?: string;
    },
  ) {
    return this.financial.runSettlementBatch(
      Math.min(100, Math.max(1, Number(body?.limit) || 25)),
      body?.onlyFailed === true,
      body?.search,
      body?.from,
      body?.to,
    );
  }
}
