import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditService } from "./audit.service";
import { RolesService } from "./roles.service";
import { StaffService } from "./staff.service";
import { AuditController } from "./audit.controller";
import { RolesController } from "./roles.controller";
import { StaffController } from "./staff.controller";
import { AuditInterceptor } from "./audit.interceptor";
import { PermissionsGuard } from "../../common/guards/permissions.guard";

/**
 * وحدة RBAC والسجلات:
 * - إدارة الأدوار والصلاحيات والموظفين.
 * - سجل التدقيق (Audit) وسجل النشاط (Activity).
 * - AuditInterceptor مُسجّل عالميًا لتتبّع كل عمليات الكتابة.
 */
@Module({
  providers: [
    AuditService,
    RolesService,
    StaffService,
    PermissionsGuard,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  controllers: [AuditController, RolesController, StaffController],
  exports: [AuditService, PermissionsGuard],
})
export class RbacModule {}
