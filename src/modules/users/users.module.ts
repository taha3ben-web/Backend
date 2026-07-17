import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PassengerSelfController } from "./passenger-self.controller";
import { FinancialModule } from "../financial/financial.module";

@Module({
  imports: [FinancialModule],
  providers: [UsersService],
  controllers: [UsersController, PassengerSelfController],
  exports: [UsersService],
})
export class UsersModule {}
