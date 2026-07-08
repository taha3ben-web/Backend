import { Module } from "@nestjs/common";
import { AppVersionsService } from "./app-versions.service";
import { AppVersionsController } from "./app-versions.controller";

@Module({
  providers: [AppVersionsService],
  controllers: [AppVersionsController],
  exports: [AppVersionsService],
})
export class AppVersionsModule {}
