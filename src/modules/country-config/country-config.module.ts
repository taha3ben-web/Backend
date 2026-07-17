import { Module } from "@nestjs/common";
import { CountryConfigService } from "./country-config.service";
import { CountryConfigController } from "./country-config.controller";

/**
 * وحدة إعدادات البلدان (Multi-Country): عملة/ضريبة/تطبيع هاتف/locale/
 * timezone/طرق دفع لكل بلد. تصدّر الخدمة لتستهلكها المالية/التسعير/التسجيل.
 */
@Module({
  providers: [CountryConfigService],
  controllers: [CountryConfigController],
  exports: [CountryConfigService],
})
export class CountryConfigModule {}
