import { Module } from "@nestjs/common";
import { AdsService } from "./ads.service";
import { AdsController } from "./ads.controller";

/** وحدة الإعلانات (CRUD من لوحة التحكم + استعلام نشط للتطبيقات). */
@Module({
  providers: [AdsService],
  controllers: [AdsController],
  exports: [AdsService],
})
export class AdsModule {}
