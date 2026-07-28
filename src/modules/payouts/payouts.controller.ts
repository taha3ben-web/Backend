import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { RequireIdempotency } from "../../common/http/require-idempotency.decorator";
import { PayoutBatchService, PayoutItemDraft } from "./payout-batch.service";
import { PayoutBridgeService } from "./payout-bridge.service";
import { PayoutBatchStatus } from "./payout.util";

@Controller("payments/payouts")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class PayoutsController {
  constructor(
    private readonly service: PayoutBatchService,
    private readonly bridge: PayoutBridgeService,
  ) {}

  @Post()
  @RequireIdempotency()
  create(
    @Body("provider") provider: string,
    @Body("items") items: PayoutItemDraft[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createBatch(provider ?? "manual", items, user.userId);
  }

  /** طلبات السحب المعتمدة التي تنتظر دفعة صرف. */
  @Get("queue")
  queue(@Query("limit") limit?: string) {
    return this.bridge.queue(limit ? Number(limit) : 100);
  }

  /** ينشئ دفعة من طلبات سحب معتمدة مباشرة. */
  @Post("from-withdrawals")
  @RequireIdempotency()
  fromWithdrawals(
    @Body("provider") provider: string,
    @Body("withdrawRequestIds") withdrawRequestIds: string[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.bridge.draftFromWithdrawals(
      provider ?? "manual",
      withdrawRequestIds ?? [],
      user.userId,
    );
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.service.list(status);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  /** إتمام الدفعة: يصرف كل طلب سحب مرتبط ويُفرِج عن المبلغ المحجوز. */
  @Post(":id/settle")
  @RequireIdempotency()
  settle(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.bridge.settleBatch(id, user.userId);
  }

  @Patch(":id/status")
  transition(
    @Param("id") id: string,
    @Body("status") status: PayoutBatchStatus,
    @Body("reason") reason?: string,
  ) {
    return this.service.transition(id, status, reason);
  }

  /** تحديث بيانات التحويل البنكي لسائق من لوحة التحكم. */
  @Put("drivers/:driverId/bank")
  setDriverBank(
    @Param("driverId", ParseUUIDPipe) driverId: string,
    @Body("iban") iban?: string,
    @Body("bankName") bankName?: string,
    @Body("accountHolder") accountHolder?: string,
  ) {
    return this.bridge.setBankDetails(driverId, {
      iban,
      bankName,
      accountHolder,
    });
  }
}

/** بيانات البنك الخاصة بالسائق نفسه. */
@Controller("drivers/payout-bank")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("DRIVER")
export class DriverPayoutBankController {
  constructor(private readonly bridge: PayoutBridgeService) {}

  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.bridge.bankDetailsForUser(user.userId);
  }

  @Put("me")
  async update(
    @CurrentUser() user: AuthUser,
    @Body("iban") iban?: string,
    @Body("bankName") bankName?: string,
    @Body("accountHolder") accountHolder?: string,
  ) {
    const driver = await this.bridge.bankDetailsForUser(user.userId);
    return this.bridge.setBankDetails(driver.id, {
      iban,
      bankName,
      accountHolder,
    });
  }
}
