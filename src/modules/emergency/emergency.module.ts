import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { RbacModule } from "../rbac/rbac.module";
import { EmergencyService } from "./emergency.service";
import { EmergencyController } from "./emergency.controller";
import { SafetyService } from "./safety.service";
import { SafetyController } from "./safety.controller";
import { TripShareService } from "./trip-share.service";
import {
  PublicTripShareController,
  TripShareController,
} from "./trip-share.controller";

/**
 * وحدة السلامة والطوارئ.
 *
 * ملاحظة مهمّة: `SafetyService` و`SafetyController` كانا موجودين في الشفرة لكنّهما
 * لم يُسجّلا في أي وحدة، فلم يكن مسار الـ SOS موجودًا أصلًا عند التشغيل.
 */
@Module({
  // NotificationsModule يُصدّر SmsProvider لإبلاغ جهات الطوارئ عند الـ SOS،
  // وNotificationsService لإشعار المبلّغ بأن نداءه استُلم.
  // RbacModule يُصدّر AuditService لتسجيل من أنشأ البلاغ ومن عالجه ومتى.
  imports: [NotificationsModule, RbacModule],
  providers: [EmergencyService, SafetyService, TripShareService],
  controllers: [
    EmergencyController,
    SafetyController,
    TripShareController,
    PublicTripShareController,
  ],
  exports: [EmergencyService, SafetyService, TripShareService],
})
export class EmergencyModule {}
