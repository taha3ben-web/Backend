import { Module, forwardRef } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsScheduler } from "./notifications.scheduler";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { DeviceTokensService } from "./device-tokens.service";
import { PushProvider } from "./providers/push.provider";
import { SmsProvider } from "./providers/sms.provider";
import { EmailProvider } from "./providers/email.provider";

@Module({
  // تبعية دائرية حقيقية: NotificationsModule → RealtimeModule → (Matching|Trips)Module
  // → NotificationsModule. كل أطراف الحلقة الأخرى تستخدم forwardRef أصلاً،
  // وهذا الطرف وحده كان مرجعًا مباشرًا، فإن دُخلت الحلقة من مسار يمرّ
  // بـ RealtimeModule أولاً (AppModule → UsersModule → ProfileLevelsModule →
  // RealtimeModule → MatchingModule → NotificationsModule) يكون تصدير
  // realtime.module تحت التنفيذ وقيمته undefined لحظة تقييم هذا المزين.
  // AuthModule يُصدّر FirebaseAdminService المستخدم لإرسال FCM (HTTP v1)،
  // ولا يستورد NotificationsModule فلا حلقة عليه — يبقى مرجعًا مباشرًا.
  imports: [forwardRef(() => RealtimeModule), AuthModule],
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
  exports: [
    NotificationsService,
    NotificationDispatcher,
    DeviceTokensService,
    SmsProvider,
  ],
})
export class NotificationsModule {}
