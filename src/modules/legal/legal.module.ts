import { Module } from "@nestjs/common";
import { LegalService } from "./legal.service";
import { LegalController } from "./legal.controller";
import { PublicLegalController } from "./public-legal.controller";

@Module({
  providers: [LegalService],
  controllers: [LegalController, PublicLegalController],
  exports: [LegalService],
})
export class LegalModule {}
