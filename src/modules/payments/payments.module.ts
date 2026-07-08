import { Module } from "@nestjs/common";
import { WalletService } from "./wallet.service";
import { PaymentsService } from "./payments.service";
import { WithdrawalsService } from "./withdrawals.service";
import { WalletController } from "./wallet.controller";
import { PaymentsController } from "./payments.controller";
import { WithdrawalsController } from "./withdrawals.controller";

@Module({
  providers: [WalletService, PaymentsService, WithdrawalsService],
  controllers: [WalletController, PaymentsController, WithdrawalsController],
  exports: [WalletService, PaymentsService, WithdrawalsService],
})
export class PaymentsModule {}
