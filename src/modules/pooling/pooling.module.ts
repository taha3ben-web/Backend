import { Module } from "@nestjs/common";
import { PoolingService } from "./pooling.service";
import { PoolingController } from "./pooling.controller";

/**
 * وحدة أساس المشاركة في الرحلة (Ride Pooling). مستقلة وتُصدّر الخدمة
 * لتُستخدم في مراحل لاحقة (ربطها بتدفق الطلب والتسعير).
 */
@Module({
  providers: [PoolingService],
  controllers: [PoolingController],
  exports: [PoolingService],
})
export class PoolingModule {}
