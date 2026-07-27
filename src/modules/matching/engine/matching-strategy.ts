import { RideClass } from "@prisma/client";

/** مرشّح سائق مع بيانات الترتيب. */
export interface DriverCandidate {
  userId: string;
  /** رتبة القرب (0 = الأقرب) حسب ترتيب Redis GEO. */
  proximityRank: number;
  /** تقييم السائق (إن توفّر) — يُفيد استراتيجية "أفضل سائق". */
  rating?: number | null;
  /**
   * الزمن المتوقع للوصول إلى نقطة الانطلاق بالثواني على شبكة الطرق الحقيقية.
   * الأقرب جغرافيًا ليس بالضرورة الأسرع وصولًا (نهر، طريق سيار مقسوم، اتجاه واحد).
   */
  etaSeconds?: number | null;
  /** مسافة الطريق إلى نقطة الانطلاق بالأمتار (إن توفّرت). */
  roadDistanceMeters?: number | null;
}

/** سياق المطابقة. */
export interface MatchingContext {
  pickupLat: number;
  pickupLng: number;
  radiusKm: number;
  rideClass: RideClass;
  vehicleTypeId?: string | null;
}

/**
 * استراتيجية المطابقة — واجهة قابلة للتبديل (Strategy Pattern).
 * يمكن مستقبلاً إضافة: أفضل سائق، الأولوية، المزادات، AI...
 * دون أي تعديل على حلقة المطابقة نفسها.
 */
export interface MatchingStrategy {
  readonly name: string;
  rank(candidates: DriverCandidate[], ctx: MatchingContext): DriverCandidate[];
}
