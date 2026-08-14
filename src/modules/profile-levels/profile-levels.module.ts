import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { ProfileLevelsService } from "./profile-levels.service";

/**
 * المرحلة 11 — وحدة مستويات الملف الشخصي.
 *
 * تُستورد من UsersModule و DriversModule و TripsModule و MatchingModule
 * لتبقى نقطة الحساب واحدة. StorageService عالمي (@Global) فلا يُستورد هنا.
 * RealtimeModule بـ forwardRef لأنه يستورد TripsModule/MatchingModule بدوره.
 */
@Module({
  imports: [forwardRef(() => RealtimeModule)],
  providers: [ProfileLevelsService],
  exports: [ProfileLevelsService],
})
export class ProfileLevelsModule {}
