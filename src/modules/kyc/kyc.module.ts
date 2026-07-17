import { Module } from "@nestjs/common";
import { KycService } from "./kyc.service";
import { KycController } from "./kyc.controller";

/** وحدة تحقق هوية المستخدم (KYC) — إضافية ومستقلة بالكامل. */
@Module({
  providers: [KycService],
  controllers: [KycController],
  exports: [KycService],
})
export class KycModule {}
