import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TransactionalEmailModule } from "../notifications/transactional-email.module";
import { LostItemsService } from "./lost-items.service";
import { LostItemsController } from "./lost-items.controller";

@Module({
  imports: [PrismaModule, NotificationsModule, TransactionalEmailModule],
  controllers: [LostItemsController],
  providers: [LostItemsService],
  exports: [LostItemsService],
})
export class LostItemsModule {}
