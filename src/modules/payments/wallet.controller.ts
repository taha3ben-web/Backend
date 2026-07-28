import {
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
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
}
