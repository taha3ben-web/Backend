import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { PayoutBatchService, PayoutItemDraft } from "./payout-batch.service";
import { PayoutBatchStatus } from "./payout.util";

@Controller("payments/payouts")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class PayoutsController {
  constructor(private readonly service: PayoutBatchService) {}

  @Post()
  create(
    @Body("provider") provider: string,
    @Body("items") items: PayoutItemDraft[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createBatch(provider ?? "manual", items, user.userId);
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.service.list(status);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Patch(":id/status")
  transition(
    @Param("id") id: string,
    @Body("status") status: PayoutBatchStatus,
    @Body("reason") reason?: string,
  ) {
    return this.service.transition(id, status, reason);
  }
}
