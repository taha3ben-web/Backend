/**
 * حساب زمن انتظار السائق عند نقطة الالتقاء — من طوابع زمنية يكتبها الخادم فقط.
 *
 * لماذا هذا الملف؟ رسوم الانتظار كانت (قبل المرحلة 7) تعتمد على قيمة
 * waitingSeconds يمرّرها المتصل، أي أن التطبيق يستطيع تحديد ما سيدفعه الراكب.
 * الآن مصدر الحقيقة الوحيد هو:
 *
 *   - بداية الانتظار: طابع حدث `status:ARRIVING` في جدول TripEvent، وهو الحدث
 *     الذي يكتبه TripsService.changeStatus بنفسه (createdAt من قاعدة البيانات)
 *     عندما يضغط السائق "وصلت". لا يصل أي رقم من التطبيق.
 *   - نهاية الانتظار: trip.startedAt، وهو أيضًا طابع خادمي يُكتب عند الانتقال
 *     إلى IN_PROGRESS.
 *
 * ملاحظة أمنية صريحة (مذكورة في تقرير المرحلة): السائق يستطيع الضغط على
 * "وصلت" قبل وصوله الفعلي فيطيل زمن الانتظار المحتسب. الحمايات المطبّقة هنا:
 *   1) سقف مطلق MAX_WAITING_SECONDS يمنع القيم الشاذة (رحلة نُسيت مفتوحة).
 *   2) سقف مالي اختياري maxCharge في سياسة اللوحة (pricing.fees.waiting).
 * التحقق الجغرافي (أن السائق فعلًا داخل نطاق نقطة الالتقاء لحظة "وصلت")
 * يحتاج مقارنة إحداثيات مباشرة، وهو مُدرج ضمن ما تبقّى.
 */

/** نوع حدث بداية الانتظار كما يكتبه changeStatus. */
export const ARRIVAL_EVENT_TYPE = "status:ARRIVING";

/** سقف مطلق (ساعتان) لأي زمن انتظار محتسب، حمايةً من القيم الشاذة. */
export const MAX_WAITING_SECONDS = 7200;

/**
 * الفرق بالثواني بين وصول السائق وبدء الرحلة.
 * يُرجع 0 عند غياب أي من الطابعين أو عند ترتيب زمني غير منطقي.
 */
export function computeWaitingSeconds(
  arrivedAt?: Date | null,
  startedAt?: Date | null,
  maxSeconds: number = MAX_WAITING_SECONDS,
): number {
  if (!arrivedAt || !startedAt) return 0;
  const seconds = Math.floor(
    (startedAt.getTime() - arrivedAt.getTime()) / 1000,
  );
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, Math.max(0, maxSeconds));
}
