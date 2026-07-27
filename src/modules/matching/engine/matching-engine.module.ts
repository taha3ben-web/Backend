import { Module } from "@nestjs/common";
import { MatchingEngineService } from "./matching-engine.service";
import { GeoModule } from "../../geo/geo.module";

/**
 * محرك المطابقة المستقل. يعتمد على Prisma + Redis (كلاهما عام)
 * وعلى GeoModule للحصول على `RoutingService` (ETA حقيقي على شبكة الطرق).
 */
@Module({
  imports: [GeoModule],
  providers: [MatchingEngineService],
  exports: [MatchingEngineService],
})
export class MatchingEngineModule {}
