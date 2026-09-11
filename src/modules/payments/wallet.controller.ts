import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { WalletTopUpStatus } from "@prisma/client";
import { WalletService } from "./wallet.service";
import { WalletTopUpsService } from "./wallet-topups.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { CreateWalletTopUpDto } from "./dto/wallet-topup.dto";

@UseGuards(JwtAuthGuard)
@Controller("wallet")
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topUps: WalletTopUpsService,
  ) {}

  /**
   * محفظة المستخدم الحالي (راكب أو سائق).
   *
   * الرد يحمل `withdrawable: false` صراحةً: هذا الرصيد للدفع داخل التطبيق
   * (أو لتغطية عمولة السائق) ولا يوجد أي مسار سحب أو صرف نقدي له.
   */
  @Get("me")
  myWallet(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.wallet.getWithTransactions(user.userId, q);
  }

  /**
   * شحن المحفظة. نفس المسار للراكب (flaminGO Pay) وللسائق (محفظة العمولة)
   * لأن الحساب المحاسبي واحد ويختلف معناه التجاري بنوع المستخدم.
   */
  @Post("topups")
  createTopUp(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWalletTopUpDto,
  ) {
    return this.topUps.create(user.userId, dto);
  }

  /** عمليات الشحن الخاصة بالمستخدم الحالي. */
  @Get("topups")
  myTopUps(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.topUps.listForUser(user.userId, q);
  }
}

/**
 * إدارة الشحن من لوحة التحكم: سجلات الشحن، التسوية، والتأكيد اليدوي
 * للشحن غير الإلكتروني (نقدًا عند وكيل) الذي لا يُرسل مزوّده أي webhook.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@Controller("admin/wallet/topups")
export class WalletTopUpsAdminController {
  constructor(private readonly topUps: WalletTopUpsService) {}

  @RequirePermissions("payments.read", "payments.manage")
  @Get()
  list(
    @Query() q: PaginationDto,
    @Query("status") status?: WalletTopUpStatus,
    @Query("userId") userId?: string,
    @Query("provider") provider?: string,
  ) {
    return this.topUps.adminList(q, { status, userId, provider });
  }

  @RequirePermissions("payments.manage")
  @Post(":id/capture")
  capture(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.topUps.capture(id, user.userId);
  }
}
