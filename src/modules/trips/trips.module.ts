import { Module, forwardRef } from "@nestjs/common";
import { TripsService } from "./trips.service";
import { RouteDeviationService } from "./route-deviation.service";
import { TrackingRetentionService } from "./tracking-retention.service";
import { TripArchiveService } from "./trip-archive.service";
import { TripArchiveController } from "./trip-archive.controller";
import { TripsController } from "./trips.controller";
import { TripLifecycleDriverController } from "./trip-lifecycle-driver.controller";
import { RealtimeModule } from "../realtime/realtime.module";
import { FinancialModule } from "../financial/financial.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SettingsModule } from "../settings/settings.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { LoyaltyModule } from "../loyalty/loyalty.module";
import { ReferralModule } from "../referral/referral.module";
import { TransactionalEmailModule } from "../notifications/transactional-email.module";
import { CallsModule } from "../calls/calls.module";
import { TripGuardsModule } from "./trip-guards.module";
import { ProfileLevelsModule } from "../profile-levels/profile-levels.module";

@Module({
  imports: [
    forwardRef(() => RealtimeModule),
    FinancialModule,
    // تبعية دائرية: TripsModule → NotificationsModule → RealtimeModule → TripsModule.
    // نؤجّل تقييم NotificationsModule بـ forwardRef حتى لا يُقرأ undefined وقت التحميل.
    forwardRef(() => NotificationsModule),
    SettingsModule,
    InvoicesModule,
    LoyaltyModule,
    ReferralModule,
    TransactionalEmailModule,
    // إبطال جلسات الاتصال عند إنهاء/إلغاء الرحلة. CallsModule لا يستورد TripsModule
    // فلا حلقة دائرية هنا — لا حاجة لـ forwardRef.
    CallsModule,
    // حراسات إغلاق المرحلة 10 (مصدر واحد لسياسة الإلغاء وحراسة الوصول).
    TripGuardsModule,
    // المرحلة 11: إعادة حساب مستوى الملف الشخصي عند اكتمال الرحلة.
    ProfileLevelsModule,
  ],
  providers: [
    TripsService,
    RouteDeviationService,
    TrackingRetentionService,
    TripArchiveService,
  ],
  controllers: [
    TripsController,
    TripLifecycleDriverController,
    TripArchiveController,
  ],
  exports: [
    TripsService,
    RouteDeviationService,
    TrackingRetentionService,
    TripArchiveService,
  ],
})
export class TripsModule {}
