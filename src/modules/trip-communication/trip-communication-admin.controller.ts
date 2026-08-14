import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { TripCommunicationAdminService } from "./trip-communication-admin.service";

/**
 * واجهة الإدارة للتواصل داخل الرحلة.
 *
 * مسار منفصل عن `/trip-communication` عن قصد: ذاك مقيّد بـ `@Roles("PASSENGER","DRIVER")`
 * ومبني على ملكية الرحلة، وخلط مسار إداري فيه كان سيفتح ثغرة تصريح.
 *
 * الصلاحيات مأخوذة من الكتالوج الموجود فعلًا (لا نخترع صلاحية جديدة غير
 * موجودة في seed — وهي نفس المشكلة التي وقعت مع `promoCodes.manage` سابقًا):
 *
 * - `trips.read`      → القوائم والملخّصات الوصفية (بلا نصوص).
 * - `support.manage`  → نص المحادثة، لأنه محتوى خاص لا يُفتح إلا لمعالجة نزاع.
 */
@Controller("admin/trip-communication")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class TripCommunicationAdminController {
  constructor(private readonly admin: TripCommunicationAdminService) {}

  @RequirePermissions("trips.read")
  @Get()
  list(@Query() q: PaginationDto) {
    return this.admin.list(q);
  }

  @RequirePermissions("trips.read")
  @Get(":tripId/summary")
  summary(@Param("tripId") tripId: string) {
    return this.admin.summary(tripId);
  }

  @RequirePermissions("support.manage")
  @Get(":tripId/transcript")
  transcript(@Param("tripId") tripId: string, @Query() q: PaginationDto) {
    return this.admin.transcript(tripId, q);
  }
}
