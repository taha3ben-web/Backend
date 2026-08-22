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

/**
 * المرحلة د — سلّم الطبقات ومزاياها (Tier Ladder & Benefits).
 *
 * سبب وجود هذا القسم: شاشة الطبقات في تطبيق السائق تحتاج أن تعرض السلّم كاملًا
 * (كل طبقة وعتبتها) لا الطبقة الحالية وحدها. وبدون كشفه من الخادم كان التطبيق
 * سيُضطر لكتابة الأرقام 0/10/50/100/500 داخله، وهو ما يخالف صراحةً التحذير
 * المكتوب في أعلى هذا الملف: لا تُنسخ العتبات إلى DriverApp إطلاقًا.
 *
 * المزايا نصوص باللغات الثلاث لأن التطبيق ممنوع من كتابة نصوص ثابتة داخله.
 *
 * قرار مقصود — لا نعِد السائق بما لا ينفّذه الخادم:
 *   محرّك التوزيع (matching-engine) يوزّع بنوع المركبة والمسافة فقط، ولا يمنح
 *   أي أولوية للطبقة، ولا توجد أي حسومات عمولة مرتبطة بالطبقات في الكود. لذلك
 *   المزايا المذكورة هنا محصورة فيما هو قائم فعلًا (الإطار المرئي للراكب،
 *   ودخول الصدارة). أي ميزة تجارية (أولوية طلبات، حسم عمولة، مكافأة) يجب أن
 *   تُنفَّذ في الخادم أولًا ثم تُضاف هنا، ولا تُعرض للسائق قبل ذلك.
 */

export interface ProfileLevelBenefit {
  /** مفتاح ثابت للتطبيق (أيقونة/تتبّع)، لا يُترجم ولا يُعرض. */
  key: string;
  ar: string;
  fr: string;
  en: string;
}

/** مزايا مشتركة لكل الطبقات (تُعرض مرة واحدة، لا تُكرَّر في كل درجة). */
export const PROFILE_LEVEL_COMMON_BENEFITS: ProfileLevelBenefit[] = [
  {
    key: "leaderboard",
    ar: "ظهورك في صدارة السائقين في ولايتك وفي الجزائر كاملة",
    fr: "Votre place dans le classement des chauffeurs de votre wilaya et de toute l'Algérie",
    en: "Your place in the driver leaderboard for your wilaya and all of Algeria",
  },
];

/** مزايا كل طبقة على حدة. الإطار حقيقي: الراكب يراه في بطاقة الرحلة. */
export const PROFILE_LEVEL_BENEFITS: Record<
  ProfileLevel,
  ProfileLevelBenefit[]
> = {
  BRONZE: [
    {
      key: "frame",
      ar: "إطار برونزي حول صورتك يظهر للراكب",
      fr: "Cadre bronze autour de votre photo, visible par le passager",
      en: "Bronze frame around your photo, visible to the passenger",
    },
  ],
  SILVER: [
    {
      key: "frame",
      ar: "إطار فضي حول صورتك يظهر للراكب",
      fr: "Cadre argent autour de votre photo, visible par le passager",
      en: "Silver frame around your photo, visible to the passenger",
    },
  ],
  GOLD: [
    {
      key: "frame",
      ar: "إطار ذهبي حول صورتك يظهر للراكب",
      fr: "Cadre or autour de votre photo, visible par le passager",
      en: "Gold frame around your photo, visible to the passenger",
    },
  ],
  DIAMOND: [
    {
      key: "frame",
      ar: "إطار ألماسي حول صورتك يظهر للراكب",
      fr: "Cadre diamant autour de votre photo, visible par le passager",
      en: "Diamond frame around your photo, visible to the passenger",
    },
  ],
  LEGENDARY: [
    {
      key: "frame",
      ar: "إطار أسطوري حول صورتك يظهر للراكب",
      fr: "Cadre légendaire autour de votre photo, visible par le passager",
      en: "Legendary frame around your photo, visible to the passenger",
    },
  ],
};

export interface ProfileLevelLadderStep {
  level: ProfileLevel;
  /** أدنى عدد رحلات مكتملة للوصول إلى هذه الدرجة. */
  minCompletedTrips: number;
  /** مفتاح الإطار؛ الرابط يُولَّد في الخدمة، لا هنا. */
  frameKey: string;
  benefits: ProfileLevelBenefit[];
  /** درجة السائق الحالية. */
  isCurrent: boolean;
  /** بلغها السائق (الحالية وما تحتها). */
  isReached: boolean;
  /** رحلات ناقصة للوصول إليها، و0 لما بلغه. */
  tripsRemaining: number;
}

/** السلّم كاملًا موصوفًا بالنسبة لعدد رحلات السائق. */
export function profileLevelLadder(
  completedTripsCount: number,
): ProfileLevelLadderStep[] {
  const count = normalizeCount(completedTripsCount);
  const current = getProfileLevel(count);
  return PROFILE_LEVELS.map((level) => {
    const min = PROFILE_LEVEL_THRESHOLDS[level];
    return {
      level,
      minCompletedTrips: min,
      frameKey: profileFrameObjectKey(level),
      benefits: PROFILE_LEVEL_BENEFITS[level],
      isCurrent: level === current,
      isReached: count >= min,
      tripsRemaining: Math.max(0, min - count),
    };
  });
}

/**
 * نسبة التقدّم داخل الطبقة الحالية (0–100).
 *
 * تُحسب هنا لا في التطبيق، لأن حسابها يحتاج عتبة الطبقة الحالية وعتبة التالية،
 * وكلتاهما ممنوعتان من النسخ إلى التطبيق. وتُرجع 100 عند أعلى طبقة لأنه لا يوجد
 * ما بعدها، فشريط التقدّم يكون مكتملًا لا فارغًا.
 */
export function profileLevelProgressPercent(
  completedTripsCount: number,
): number {
  const count = normalizeCount(completedTripsCount);
  const level = getProfileLevel(count);
  const next = nextProfileLevel(level);
  if (next === null) return 100;
  const from = PROFILE_LEVEL_THRESHOLDS[level];
  const to = PROFILE_LEVEL_THRESHOLDS[next];
  const span = to - from;
  if (span <= 0) return 100;
  const pct = ((count - from) / span) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}
