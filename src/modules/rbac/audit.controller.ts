import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("audit.read")
@Controller("logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** سجل التدقيق (عمليات الكتابة داخل النظام) */
  @Get("audit")
  audits(
    @Query() q: PaginationDto,
    @Query("actorId") actorId?: string,
    @Query("entity") entity?: string,
  ) {
    return this.audit.findAuditLogs(q, { actorId, entity });
  }

  /** سجل النشاط (أنشطة المستخدمين) */
  @Get("activity")
  activity(@Query() q: PaginationDto, @Query("userId") userId?: string) {
    return this.audit.findActivityLogs(q, userId);
  }
}
