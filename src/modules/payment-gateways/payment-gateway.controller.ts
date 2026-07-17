import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { PaymentGatewayService } from "./payment-gateway.service";
import {
  RecentEventsQueryDto,
  WebhookHealthQueryDto,
} from "./dto/payment-gateway.dto";

/**
 * رؤية مزوّدي الدفع (PSP) وصحّة الـ webhooks — مسار `dashboard/payments/gateways`
 * للموظّفين (قراءة فقط). يكمّل تدفّق الدفع القائم دون تكراره.
 */
@Controller("dashboard/payments/gateways")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class PaymentGatewayController {
  constructor(private readonly gateways: PaymentGatewayService) {}

  @Get("providers")
  @RequirePermissions("payments.read", "payments.manage")
  providers() {
    return this.gateways.listProviders();
  }

  @Get("webhook-health")
  @RequirePermissions("payments.read", "payments.manage")
  webhookHealth(@Query() query: WebhookHealthQueryDto) {
    return this.gateways.webhookHealth(query.windowHours ?? 24);
  }

  @Get("recent-events")
  @RequirePermissions("payments.read", "payments.manage")
  recentEvents(@Query() query: RecentEventsQueryDto) {
    return this.gateways.recentEvents(query.limit ?? 30);
  }
}
