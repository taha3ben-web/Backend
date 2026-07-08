import { Module } from "@nestjs/common";
import { SupportService } from "./support.service";
import { ComplaintsService } from "./complaints.service";
import { RatingsService } from "./ratings.service";
import { SupportController } from "./support.controller";
import { ComplaintsController } from "./complaints.controller";
import { RatingsController } from "./ratings.controller";

@Module({
  providers: [SupportService, ComplaintsService, RatingsService],
  controllers: [SupportController, ComplaintsController, RatingsController],
  exports: [SupportService, ComplaintsService, RatingsService],
})
export class SupportModule {}
