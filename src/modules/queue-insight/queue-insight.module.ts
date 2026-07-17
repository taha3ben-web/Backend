import { Module } from "@nestjs/common";
import { QueueInsightController } from "./queue-insight.controller";
import { QueueInsightService } from "./queue-insight.service";

/**
 * وحدة رؤية وصيانة الطابور الخلفي. تعتمد على PrismaService (عالمي)
 * و OutboxService (مُصدّر من InfraModule العالمي) — لا حاجة لإعادة استيرادهما.
 */
@Module({
  controllers: [QueueInsightController],
  providers: [QueueInsightService],
})
export class QueueInsightModule {}
