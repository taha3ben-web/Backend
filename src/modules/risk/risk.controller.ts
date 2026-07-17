import {
  Body,
  Controller,
  Delete,
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
import {
  BlacklistKind,
  RiskService,
  RiskSubjectKind,
} from "./risk.service";

@Controller("risk")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  // ----- قائمة الحظر -----
  @RequirePermissions("risk.manage")
  @Get("blacklist")
  listBlacklist(@Query("kind") kind?: BlacklistKind) {
    return this.risk.listBlacklist(kind);
  }

  @RequirePermissions("risk.manage")
  @Post("blacklist")
  addBlacklist(
    @Body() body: { kind: BlacklistKind; value: string; reason?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.risk.addBlacklist(
      body.kind,
      body.value,
      body.reason,
      user.userId,
    );
  }

  @RequirePermissions("risk.manage")
  @Delete("blacklist")
  removeBlacklist(@Body() body: { kind: BlacklistKind; value: string }) {
    return this.risk.removeBlacklist(body.kind, body.value);
  }

  // ----- الحجز اليدوي -----
  @RequirePermissions("risk.manage")
  @Get("holds")
  listHolds(@Query("active") active?: string) {
    return this.risk.listHolds(active !== "false");
  }

  @RequirePermissions("risk.manage")
  @Post("holds")
  placeHold(
    @Body()
    body: {
      subjectKind: RiskSubjectKind;
      subjectId: string;
      reason?: string;
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.risk.placeHold(
      body.subjectKind,
      body.subjectId,
      body.reason,
      user.userId,
    );
  }

  @RequirePermissions("risk.manage")
  @Post("holds/:id/release")
  releaseHold(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.risk.releaseHold(id, user.userId);
  }

  // ----- سجل أحداث المخاطر -----
  @RequirePermissions("risk.review")
  @Get("events")
  listEvents(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("subjectKind") subjectKind?: string,
    @Query("decision") decision?: string,
    @Query("subjectId") subjectId?: string,
  ) {
    return this.risk.listEvents({
      page: Math.max(1, parseInt(page ?? "1", 10) || 1),
      limit: Math.min(100, parseInt(limit ?? "20", 10) || 20),
      subjectKind: subjectKind || undefined,
      decision: decision || undefined,
      subjectId: subjectId || undefined,
    });
  }

  // ----- ذكاء الاحتيال والإساءة (مُجمّع، قراءة فقط) -----
  @RequirePermissions("risk.review")
  @Get("fraud-signals")
  fraudSignals(@Query("from") from?: string, @Query("to") to?: string) {
    return this.risk.fraudSignals(from, to);
  }

  // ----- طابور المراجعة -----
  @RequirePermissions("risk.review")
  @Get("reviews")
  listReviews(@Query("status") status?: "OPEN" | "APPROVED" | "REJECTED") {
    return this.risk.listReviews(status ?? "OPEN");
  }

  @RequirePermissions("risk.review")
  @Post("reviews/:id/resolve")
  resolveReview(
    @Param("id") id: string,
    @Body() body: { decision: "APPROVED" | "REJECTED"; resolution?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.risk.resolveReview(
      id,
      body.decision,
      user.userId,
      body.resolution,
    );
  }
}
