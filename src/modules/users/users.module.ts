import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { PassengerSelfController } from "./passenger-self.controller";

@Module({
  providers: [UsersService],
  controllers: [UsersController, PassengerSelfController],
  exports: [UsersService],
})
export class UsersModule {}
