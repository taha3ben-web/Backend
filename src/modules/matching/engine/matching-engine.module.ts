import { Module } from "@nestjs/common";
import { MatchingEngineService } from "./matching-engine.service";

/**
 * محرك المطابقة المستقل. يعتمد فقط على Prisma + Redis (كلاهما عام).
 */
@Module({
  providers: [MatchingEngineService],
  exports: [MatchingEngineService],
})
export class MatchingEngineModule {}
