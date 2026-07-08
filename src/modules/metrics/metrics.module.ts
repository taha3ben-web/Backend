import { Global, Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsController } from "./metrics.controller";

/**
 * وحدة الرصد — عامة (@Global) لتكون MetricsService متاحة للحقن
 * في أي وحدة (مثل RealtimeGateway) دون استيرادات متبادلة.
 * PrismaService و RedisService عالميّتان أصلاً (@Global) فتُحقنان في المتحكم.
 */
@Global()
@Module({
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
