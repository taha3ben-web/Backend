import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { SettingsModule } from "../settings/settings.module";
import { StorageModule } from "../storage/storage.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TripCommunicationController } from "./trip-communication.controller";
import { TripCommunicationAdminController } from "./trip-communication-admin.controller";
import { TripCommunicationService } from "./trip-communication.service";
import { TripCommunicationAdminService } from "./trip-communication-admin.service";

@Module({
  imports: [
    SettingsModule,
    StorageModule,
    forwardRef(() => RealtimeModule),
    // إشعارات الرسائل تمرّ عبر NotificationDispatcher الموجود — لا خدمة دفع ثانية.
    // forwardRef لأن NotificationsModule → RealtimeModule تعود إلى هذه الحلقة.
    forwardRef(() => NotificationsModule),
  ],
  controllers: [TripCommunicationController, TripCommunicationAdminController],
  providers: [TripCommunicationService, TripCommunicationAdminService],
  exports: [TripCommunicationService],
})
export class TripCommunicationModule {}
