import { Module } from "@nestjs/common";
import { CommissionService } from "./commission.service";
import { CommissionController } from "./commission.controller";

/**
 * وحدة عمولة المنصّة.
 *
 * لا تستورد أي وحدة أخرى قصدًا: تقرأ `Setting` مباشرةً عبر Prisma (نفس ما
 * يفعله `FinancialService.loadPricingFees`) بدل استيراد `SettingsModule`،
 * حتى لا تُنشأ حلقة تبعية بين التسعير والإعدادات والماليات — والثلاثة
 * تحتاج العمولة.
 */
@Module({
  providers: [CommissionService],
  controllers: [CommissionController],
  exports: [CommissionService],
})
export class CommissionModule {}
