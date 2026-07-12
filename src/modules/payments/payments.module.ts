import { Module } from "@nestjs/common";
import { FinancialModule } from "../financial/financial.module";
import { WalletService } from "./wallet.service";
import { PaymentsService } from "./payments.service";
import { WithdrawalsService } from "./withdrawals.service";
import { WalletController } from "./wallet.controller";
import { PaymentsController } from "./payments.controller";
import { WithdrawalsController } from "./withdrawals.controller";
import { PaymentProviderService } from "./payment-provider.service";
import { PaymentWebhooksController } from "./payment-webhooks.controller";
import { DriverFundingService } from "./driver-funding.service";
import { DriverFundingController } from "./driver-funding.controller";

@Module({
  imports: [FinancialModule],
  providers: [
    WalletService,
    PaymentsService,
    WithdrawalsService,
    PaymentProviderService,
    DriverFundingService,
  ],
  controllers: [
    WalletController,
    PaymentsController,
    WithdrawalsController,
    PaymentWebhooksController,
    DriverFundingController,
  ],
  exports: [
    WalletService,
    PaymentsService,
    WithdrawalsService,
    PaymentProviderService,
    DriverFundingService,
  ],
})
export class PaymentsModule {}
