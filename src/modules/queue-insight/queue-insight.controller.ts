import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { QueueInsightService } from "./queue-insight.service";
import {
  BacklogQueryDto,
  PurgeDeliveredDto,
  RetryAllDeadLettersDto,
} from "./dto/queue-insight.dto";

/**
 * رؤية وصيانة الطابور الخلفي (Outbox) — مسار `dashboard/queue` للموظّفين.
 * القراءة تتطلّب reports.read؛ التنظيف settings.manage؛ إعادة جدولة DLQ payments.manage
 * (متسق مع إعادة المحاولة الفردية في مركز العمليات).
 */
@Controller("dashboard/queue")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class QueueInsightController {
  constructor(private readonly queue: QueueInsightService) {}

  @Get("insight")
  @RequirePermissions("reports.read")
  insight() {
    return this.queue.insight();
  }

  @Get("backlog-by-name")
  @RequirePermissions("reports.read")
  backlogByName(@Query() query: BacklogQueryDto) {
    return this.queue.backlogByName(query.limit ?? 20);
  }

  @Get("dead-letters")
  @RequirePermissions("reports.read")
  deadLetters(@Query() query: BacklogQueryDto) {
    return this.queue.listDeadLetters(query.limit ?? 50);
  }

  @Post("purge-delivered")
  @RequirePermissions("settings.manage")
  purgeDelivered(@Body() body: PurgeDeliveredDto) {
    return this.queue.purgeDelivered(body.olderThanDays);
  }

  @Post("dead-letters/retry-all")
  @RequirePermissions("payments.manage")
  retryAllDeadLetters(@Body() body: RetryAllDeadLettersDto) {
    return this.queue.retryAllDeadLetters(body.limit ?? 100);
  }
}
