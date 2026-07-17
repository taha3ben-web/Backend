import { Module } from "@nestjs/common";
import { PayoutBatchService } from "./payout-batch.service";
import { PayoutsController } from "./payouts.controller";

@Module({
  providers: [PayoutBatchService],
  controllers: [PayoutsController],
  exports: [PayoutBatchService],
})
export class PayoutsModule {}
