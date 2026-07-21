import { Module } from "@nestjs/common";
import { ManagedAssetsController } from "./managed-assets.controller";
import { ManagedAssetsService } from "./managed-assets.service";
@Module({
  controllers: [ManagedAssetsController],
  providers: [ManagedAssetsService],
  exports: [ManagedAssetsService],
})
export class ManagedAssetsModule {}
