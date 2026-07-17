import { Module } from "@nestjs/common";
import { ContentBlocksService } from "./content-blocks.service";
import { ContentBlocksController } from "./content-blocks.controller";

@Module({
  providers: [ContentBlocksService],
  controllers: [ContentBlocksController],
  exports: [ContentBlocksService],
})
export class ContentBlocksModule {}
