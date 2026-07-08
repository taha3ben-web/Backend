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
import { WalletService } from "./wallet.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { WalletAdjustDto, WalletTopUpDto } from "./dto/payments.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** محفظة المستخدم الحالي (راكب أو سائق) */
  @Get("me")
  myWallet(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.wallet.getWithTransactions(user.userId, q);
  }

  /** شحن محفظتي (top-up) */
  @Post("me/top-up")
  topUp(@CurrentUser() user: AuthUser, @Body() dto: WalletTopUpDto) {
    return this.wallet.adjust(
      user.userId,
      "CREDIT",
      dto.amount,
      dto.reference ? `شحن محفظة (${dto.reference})` : "شحن محفظة",
    );
  }

  /** محفظة مستخدم معيّن (للموظفين فقط) */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get(":userId")
  userWallet(@Param("userId") userId: string, @Query() q: PaginationDto) {
    return this.wallet.getWithTransactions(userId, q);
  }

  /** تعديل يدوي لرصيد مستخدم (للموظفين فقط) */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":userId/adjust")
  adjust(@Param("userId") userId: string, @Body() dto: WalletAdjustDto) {
    return this.wallet.adjust(userId, dto.type, dto.amount, dto.reason);
  }
}
