/**
 * المرحلة 11 — مستويات الملف الشخصي وإطاراته (Profile Levels & Frames).
 *
 * هذا الملف هو المصدر الوحيد للعتبات وخريطة الإطارات في المشروع كله:
 *   - لا تُكرَّر الأرقام في أي ملف آخر في الخادم.
 *   - لا تُنسخ إلى PassengerApp أو DriverApp أو لوحة التحكم إطلاقًا؛ التطبيق
 *     يستقبل المستوى ورابط الإطار محسوبَين من الخادم.
 *
 * المستوى مشتق من عدد الرحلات المكتملة فعليًا (TripStatus.COMPLETED فقط).
 */

export const PROFILE_LEVELS = [
  "BRONZE",
  "SILVER",
  "GOLD",
  "DIAMOND",
  "LEGENDARY",
] as const;

export type ProfileLevel = (typeof PROFILE_LEVELS)[number];

/**
 * الحد الأدنى (شامل) من الرحلات المكتملة لكل مستوى:
 *   0–9 BRONZE | 10–49 SILVER | 50–99 GOLD | 100–499 DIAMOND | 500+ LEGENDARY
 */
export const PROFILE_LEVEL_THRESHOLDS: Record<ProfileLevel, number> = {
  BRONZE: 0,
  SILVER: 10,
  GOLD: 50,
  DIAMOND: 100,
  LEGENDARY: 500,
};

/**
 * مجلد الإطارات في R2. الملفات موجودة مسبقًا ولا تُرفع من الكود.
 * المخزَّن/المتداول داخليًا هو مفتاح الكائن وحده، لا الرابط الكامل.
 */
export const PROFILE_FRAMES_PREFIX = "profile-frames";

/** تطبيع أي عدد قادم من قاعدة البيانات إلى عدد صحيح غير سالب. */
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * النقطة الوحيدة لحساب المستوى في المشروع.
 * typed، ولا تقبل مستوى من العميل: مدخلها عدد الرحلات المكتملة فقط.
 */
export function getProfileLevel(completedTripsCount: number): ProfileLevel {
  const count = normalizeCount(completedTripsCount);
  if (count >= PROFILE_LEVEL_THRESHOLDS.LEGENDARY) return "LEGENDARY";
  if (count >= PROFILE_LEVEL_THRESHOLDS.DIAMOND) return "DIAMOND";
  if (count >= PROFILE_LEVEL_THRESHOLDS.GOLD) return "GOLD";
  if (count >= PROFILE_LEVEL_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
}

/** مفتاح كائن الإطار في R2 للمستوى (بلا رابط ولا نطاق). */
export function profileFrameObjectKey(level: ProfileLevel): string {
  return `${PROFILE_FRAMES_PREFIX}/${level.toLowerCase()}.svg`;
}

/** المستوى التالي، أو null عند أعلى مستوى. */
export function nextProfileLevel(level: ProfileLevel): ProfileLevel | null {
  const index = PROFILE_LEVELS.indexOf(level);
  if (index < 0 || index >= PROFILE_LEVELS.length - 1) return null;
  return PROFILE_LEVELS[index + 1];
}

export interface ProfileLevelProgress {
  completedTripsCount: number;
  profileLevel: ProfileLevel;
  /** مفتاح الكائن في R2؛ الرابط يُولَّد في الخدمة عبر StorageService. */
  profileFrameKey: string;
  nextLevel: ProfileLevel | null;
  /** عدد الرحلات المطلوب للوصول للمستوى التالي، أو null عند أعلى مستوى. */
  nextLevelAt: number | null;
  tripsToNextLevel: number | null;
}

/** يجمع المستوى + التقدّم + مفتاح الإطار في وصف واحد جاهز للعرض. */
export function describeProfileLevel(
  completedTripsCount: number,
): ProfileLevelProgress {
  const count = normalizeCount(completedTripsCount);
  const profileLevel = getProfileLevel(count);
  const next = nextProfileLevel(profileLevel);
  const nextLevelAt = next === null ? null : PROFILE_LEVEL_THRESHOLDS[next];
  return {
    completedTripsCount: count,
    profileLevel,
    profileFrameKey: profileFrameObjectKey(profileLevel),
    nextLevel: next,
    nextLevelAt,
    tripsToNextLevel: nextLevelAt === null ? null : Math.max(0, nextLevelAt - count),
  };
}
