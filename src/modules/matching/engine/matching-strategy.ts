import { RideClass } from "@prisma/client";

/** مرشّح سائق مع بيانات الترتيب. */
export interface DriverCandidate {
  userId: string;
  /** رتبة القرب (0 = الأقرب) حسب ترتيب Redis GEO. */
  proximityRank: number;
  /** تقييم السائق (إن توفّر) — يُفيد استراتيجية "أفضل سائق". */
  rating?: number | null;
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
 * يمكن مستقبلاً إضافة: أفضل سائق، الأولوية، المزادات، أسرع وصول، AI...
 * دون أي تعديل على حلقة المطابقة نفسها.
 */
export interface MatchingStrategy {
  readonly name: string;
  rank(candidates: DriverCandidate[], ctx: MatchingContext): DriverCandidate[];
}
