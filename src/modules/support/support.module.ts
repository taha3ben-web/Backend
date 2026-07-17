import { Module } from "@nestjs/common";
import { SupportService } from "./support.service";
import { ComplaintsService } from "./complaints.service";
import { RatingsService } from "./ratings.service";
import { TicketOpsService } from "./ticket-ops.service";
import { SupportController } from "./support.controller";
import { ComplaintsController } from "./complaints.controller";
import { RatingsController } from "./ratings.controller";
import { TicketOpsController } from "./ticket-ops.controller";

@Module({
  providers: [
    SupportService,
    ComplaintsService,
    RatingsService,
    TicketOpsService,
  ],
  controllers: [
    SupportController,
    ComplaintsController,
    RatingsController,
    TicketOpsController,
  ],
  exports: [
    SupportService,
    ComplaintsService,
    RatingsService,
    TicketOpsService,
  ],
})
export class SupportModule {}
