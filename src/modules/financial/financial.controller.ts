import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { FinancialService } from "./financial.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("financial")
export class FinancialController {
  constructor(private readonly financial: FinancialService) {}

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

  @Get("reconciliation/summary")
  reconciliationSummary(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.financial.reconciliationSummary(from, to);
  }

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
