import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { OpsCenterService } from "./ops-center.service";

/**
 * لوحة التحكم التشغيلية (Control Plane) — مسار موحّد `dashboard/ops`
 * للموظّفين يجمع طابور التسوية والوظائف الفاشلة والتطابق والمخاطر.
 */
@Controller("dashboard/ops")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class OpsCenterController {
  constructor(private readonly ops: OpsCenterService) {}

  @Get("overview")
  @RequirePermissions("reports.read")
  overview() {
    return this.ops.overview();
  }

  // ----- طابور التسوية -----
  @Get("settlements")
  @RequirePermissions("payments.read")
  settlementQueue(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("onlyFailed") onlyFailed?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.ops.settlementQueue(
      page ? Number(page) : 1,
      limit ? Number(limit) : 25,
      onlyFailed === "true",
      search,
      from,
      to,
    );
  }

  @Post("settlements/retry")
  @RequirePermissions("payments.manage")
  retrySettlements(
    @Body()
    body: {
      limit?: number;
      onlyFailed?: boolean;
      search?: string;
      from?: string;
      to?: string;
    },
  ) {
    return this.ops.retrySettlements(
      body.limit ?? 25,
      body.onlyFailed ?? true,
      body.search,
      body.from,
      body.to,
    );
  }

  // ----- الوظائف الفاشلة / DLQ -----
  @Get("dead-letters")
  @RequirePermissions("reports.read")
  deadLetters(@Query("limit") limit?: string) {
    return this.ops.deadLetters(limit ? Number(limit) : 100);
  }

  @Post("dead-letters/:id/retry")
  @RequirePermissions("payments.manage")
  retryDeadLetter(@Param("id") id: string) {
    return this.ops.retryDeadLetter(id);
  }

  // ----- التطابق (reconciliation) -----
  @Get("incidents")
  @RequirePermissions("reports.read")
  incidents(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: "OPEN" | "RESOLVED" | "IGNORED",
  ) {
    return this.ops.incidents(
      page ? Number(page) : 1,
      limit ? Number(limit) : 25,
      status,
    );
  }

  @Post("incidents/:id/resolve")
  @RequirePermissions("payments.manage")
  resolveIncident(
    @Param("id") id: string,
    @Body() body: { status?: "RESOLVED" | "IGNORED" },
    @CurrentUser() user: AuthUser,
  ) {
    return this.ops.resolveIncident(id, user.userId, body.status ?? "RESOLVED");
  }

  @Post("reconciliation/run")
  @RequirePermissions("payments.manage")
  runReconciliation() {
    return this.ops.runReconciliation();
  }

  // ----- مراجعة المخاطر -----
  @Get("risk-reviews")
  @RequirePermissions("reports.read")
  riskReviews(@Query("status") status?: "OPEN" | "APPROVED" | "REJECTED") {
    return this.ops.riskReviews(status ?? "OPEN");
  }
}
