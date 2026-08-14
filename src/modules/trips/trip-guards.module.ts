import { Module, forwardRef } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { CancellationPolicyService } from "./cancellation-policy.service";
import { PassengerCancellationRiskService } from "./passenger-cancellation-risk.service";
import { ArrivalGuardService } from "./arrival-guard.service";

/**
 * وحدة مشتركة لحراسات الرحلة (إغلاق المرحلة 10):
 *   - CancellationPolicyService        → قراءة العتبات من لوحة التحكم
 *   - PassengerCancellationRiskService → D-4 (تسجيل/تحدير/تجميد بلا غرامة)
 *   - ArrivalGuardService             → D-6 (منع ARRIVING المبكر)
 *
 * تُستورد من TripsModule و DriversModule و MatchingModule لمنع ازدواجية
 * المنطق: مصدر واحد للحقيقة لكل من السياستين، ولا نسخ ثانية من القواعد.
 */
@Module({
  imports: [forwardRef(() => NotificationsModule)],
  providers: [
    CancellationPolicyService,
    PassengerCancellationRiskService,
    ArrivalGuardService,
  ],
  exports: [
    CancellationPolicyService,
    PassengerCancellationRiskService,
    ArrivalGuardService,
  ],
})
export class TripGuardsModule {}
