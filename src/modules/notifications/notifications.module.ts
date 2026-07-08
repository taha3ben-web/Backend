import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsScheduler } from "./notifications.scheduler";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { DeviceTokensService } from "./device-tokens.service";
import { PushProvider } from "./providers/push.provider";
import { SmsProvider } from "./providers/sms.provider";
import { EmailProvider } from "./providers/email.provider";

@Module({
  imports: [RealtimeModule],
  providers: [
    NotificationsService,
    NotificationDispatcher,
    DeviceTokensService,
    NotificationsScheduler,
    PushProvider,
    SmsProvider,
    EmailProvider,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, DeviceTokensService],
})
export class NotificationsModule {}
