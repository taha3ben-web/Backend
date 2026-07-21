import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PassengerSelfController } from "./passenger-self.controller";
import { FinancialModule } from "../financial/financial.module";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [FinancialModule, SettingsModule],
  providers: [UsersService],
  controllers: [UsersController, PassengerSelfController],
  exports: [UsersService],
})
export class UsersModule {}
