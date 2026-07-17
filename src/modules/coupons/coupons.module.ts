import { Module } from "@nestjs/common";
import { CouponsService } from "./coupons.service";
import { CouponsController } from "./coupons.controller";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [SettingsModule],
  providers: [CouponsService],
  controllers: [CouponsController],
  exports: [CouponsService],
})
export class CouponsModule {}
