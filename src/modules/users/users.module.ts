import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PassengerSelfController } from "./passenger-self.controller";
import { GdprController } from "./gdpr.controller";
import { GdprService } from "./gdpr.service";
import { FinancialModule } from "../financial/financial.module";
import { SettingsModule } from "../settings/settings.module";
import { ProfileLevelsModule } from "../profile-levels/profile-levels.module";

@Module({
  imports: [FinancialModule, SettingsModule, ProfileLevelsModule],
  providers: [UsersService, GdprService],
  controllers: [UsersController, PassengerSelfController, GdprController],
  exports: [UsersService],
})
export class UsersModule {}
