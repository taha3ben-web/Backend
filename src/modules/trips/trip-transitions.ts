import type { TripStatus } from "@prisma/client";
export type { TripStatus };

/**
 * الانتقالات المسموح بها لحالة الرحلة (آلة حالات).
 * COMPLETED و CANCELLED حالتان نهائيتان لا خروج منهما.
 */
export const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  SCHEDULED: ["SEARCHING", "CANCELLED"],
  SEARCHING: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["ARRIVING", "CANCELLED"],
  ARRIVING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** هل يُسمح بالانتقال من الحالة from إلى الحالة to؟ */
export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * الحالات التي تكون فيها الرحلة "قائمة": السائق مُسنَد والرحلة لم تنتهِ بعد.
 *
 * المرحلة 9: هذه القائمة هي المصدر الوحيد للحقيقة لكل بوابة تعتمد على
 * "هل الرحلة جارية؟" (الدردشة، الاتصال، مشاركة الرحلة). كانت كل وحدة تعرّف
 * قائمتها الخاصة نصًّا، فتسرّبت حالات غير موجودة أصلًا في enum TripStatus
 * مثل "ARRIVED" و"ONGOING"، بينما سقطت حالات حقيقية مثل ARRIVING و
 * IN_PROGRESS. النوع TripStatus[] يجعل أي اسم غير صالح خطأ في وقت الترجمة
 * بدل أن يمر بصمت.
 */
export const LIVE_TRIP_STATUSES: TripStatus[] = [
  "ACCEPTED",
  "ARRIVING",
  "IN_PROGRESS",
];

/**
 * حالات تسمح بإنشاء رابط متابعة/مشاركة الرحلة: الرحلة القائمة + مرحلة البحث
 * عن سائق (يحق للراكب مشاركة رحلته قبل الإسناد أيضًا).
 */
export const SHAREABLE_TRIP_STATUSES: TripStatus[] = [
  "SEARCHING",
  ...LIVE_TRIP_STATUSES,
];

/** هل الرحلة قائمة الآن؟ يقبل نصًّا لأن المصدر قد يكون قيمة من قاعدة البيانات. */
export function isLiveTripStatus(status: string): boolean {
  return (LIVE_TRIP_STATUSES as readonly string[]).includes(status);
}

/**
 * حالات «الرحلة الفورية الجارية» — المصدر الوحيد للحقيقة لقاعدة التفرّد:
 * **راكب واحد ← رحلة فورية واحدة**.
 *
 * SCHEDULED غير موجودة هنا **عمدًا**: الحجز المستقبلي ليس رحلة جارية، ولا
 * يجوز أن يحجب طلب رحلة الآن. أي تعديل على هذه القائمة يجب أن يُرافقه تعديل
 * مطابق للفهرس الجزئي `Trip_active_passenger_unique` في قاعدة البيانات
 * (مايغريشن 20260912090100)، وإلا انفصلت سلطة التطبيق عن سلطة القاعدة.
 */
export const ACTIVE_IMMEDIATE_TRIP_STATUSES: TripStatus[] = [
  "SEARCHING",
  ...LIVE_TRIP_STATUSES,
];

/** هل الحالة تعني رحلة فورية جارية (تحجب طلب رحلة فورية أخرى)؟ */
export function isActiveImmediateTripStatus(status: string): boolean {
  return (ACTIVE_IMMEDIATE_TRIP_STATUSES as readonly string[]).includes(status);
}
