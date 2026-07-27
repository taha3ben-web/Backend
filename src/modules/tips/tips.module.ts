import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { FinancialModule } from "../financial/financial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TipsController } from "./tips.controller";
import { TipsService } from "./tips.service";

@Module({
  imports: [PrismaModule, FinancialModule, NotificationsModule],
  controllers: [TipsController],
  providers: [TipsService],
  exports: [TipsService],
})
export class TipsModule {}
