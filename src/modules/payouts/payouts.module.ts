import { Module } from "@nestjs/common";
import { PayoutBatchService } from "./payout-batch.service";
import { PayoutBridgeService } from "./payout-bridge.service";
import {
  DriverPayoutBankController,
  PayoutsController,
} from "./payouts.controller";
import { PaymentsModule } from "../payments/payments.module";
import { TransactionalEmailModule } from "../notifications/transactional-email.module";

@Module({
  // PaymentsModule لا يستورد PayoutsModule، فلا تبعية دائرية هنا.
  imports: [PaymentsModule, TransactionalEmailModule],
  providers: [PayoutBatchService, PayoutBridgeService],
  controllers: [PayoutsController, DriverPayoutBankController],
  exports: [PayoutBatchService, PayoutBridgeService],
})
export class PayoutsModule {}
