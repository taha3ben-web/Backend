import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * قارئ سياسات الإلغاء/الوصول من جدول الإعدادات (Setting) الذي تديره لوحة
 * التحكم. هذه ليست "نظام عقوبات ثانيًا": لا تحتفظ بحالة ولا تكتب أي شيء،
 * وظيفتها الوحيدة قراءة مفتاحين وتطبيعهما، حتى لا يوجد أي رقم hardcoded
 * داخل التطبيقات أو داخل منطق الرحلات.
 *
 *  - trips.passengerCancellationRisk  → عتبات التحذير/التجميد (D-4)
 *  - trips.arrivalGeofence            → نصف قطر السماح بتسجيل ARRIVING (D-6)
 *
 * تُقرأ publishedValue أولًا (ما نُشر فعلًا للعملاء) ثم value كمسودة، وهو نفس
 * سلوك بقية النظام (getValue في SettingsService و loadPricingFees في المالية).
 */

export const PASSENGER_CANCELLATION_RISK_KEY = "trips.passengerCancellationRisk";
export const ARRIVAL_GEOFENCE_KEY = "trips.arrivalGeofence";

export type PassengerCancellationRiskPolicy = {
  /** تشغيل/تعطيل المنظومة كاملة من اللوحة. */
  enabled: boolean;
  /** نافذة العدّ بالأيام. */
  windowDays: number;
  /** عدد الإلغاءات المؤهلة الذي يظهر عنده التحذير (0 = بلا تحذير). */
  warnThreshold: number;
  /** عدد الإلغاءات المؤهلة الذي يتم عنده التجميد التلقائي (0 = بلا تجميد). */
  freezeThreshold: number;
  /**
   * قرار المستخدم النهائي: الإلغاء قبل قبول السائق **لا** يدخل في العدّ.
   * يبقى المفتاح قابلًا للضبط من اللوحة دون تعديل الكود.
   */
  countOnlyAfterAccept: boolean;
};

export type ArrivalGeofencePolicy = {
  /** تشغيل/تعطيل حماية الوصول. */
  enabled: boolean;
  /** أقصى مسافة (متر) بين السائق ونقطة الالتقاء للسماح بـ ARRIVING. */
  radiusMeters: number;
  /** أقصى عمر مسموح لموقع السائق المحفوظ على الخادم (ثانية). */
  maxLocationAgeSeconds: number;
  /**
   * قرار المستخدم النهائي: fail-closed — إذا لم يوجد موقع على الخادم أو كان
   * قديمًا يُرفض تسجيل الوصول، لأن الهدف منع التلاعب بزمن الانتظار.
   */
  blockWhenLocationMissing: boolean;
};

export const DEFAULT_PASSENGER_CANCELLATION_RISK: PassengerCancellationRiskPolicy =
  {
    enabled: true,
    windowDays: 30,
    warnThreshold: 2,
    freezeThreshold: 3,
    countOnlyAfterAccept: true,
  };

export const DEFAULT_ARRIVAL_GEOFENCE: ArrivalGeofencePolicy = {
  enabled: true,
  radiusMeters: 200,
  maxLocationAgeSeconds: 120,
  blockWhenLocationMissing: true,
};

function bool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function int(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

@Injectable()
export class CancellationPolicyService {
  private readonly logger = new Logger(CancellationPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async readSetting(key: string): Promise<Record<string, unknown> | null> {
    try {
      const setting = await this.prisma.setting.findUnique({ where: { key } });
      const raw = setting?.publishedValue ?? setting?.value;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
      }
      return null;
    } catch (error) {
      // فشل القراءة لا يجوز أن يُسقط مسار الرحلة؛ نعود للافتراضيات ونُسجّل.
      this.logger.warn(
        `Failed to read setting ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** سياسة مخاطر إلغاء الراكب (D-4) — لوحة التحكم هي مصدر العتبات. */
  async passengerCancellationRisk(): Promise<PassengerCancellationRiskPolicy> {
    const raw = await this.readSetting(PASSENGER_CANCELLATION_RISK_KEY);
    const d = DEFAULT_PASSENGER_CANCELLATION_RISK;
    if (!raw) return d;
    return {
      enabled: bool(raw.enabled, d.enabled),
      windowDays: int(raw.windowDays, d.windowDays, 1, 365),
      warnThreshold: int(raw.warnThreshold, d.warnThreshold, 0, 100),
      freezeThreshold: int(raw.freezeThreshold, d.freezeThreshold, 0, 100),
      countOnlyAfterAccept: bool(raw.countOnlyAfterAccept, d.countOnlyAfterAccept),
    };
  }

  /** سياسة نطاق الوصول (D-6) — نصف القطر مضبوط من اللوحة. */
  async arrivalGeofence(): Promise<ArrivalGeofencePolicy> {
    const raw = await this.readSetting(ARRIVAL_GEOFENCE_KEY);
    const d = DEFAULT_ARRIVAL_GEOFENCE;
    if (!raw) return d;
    return {
      enabled: bool(raw.enabled, d.enabled),
      radiusMeters: int(raw.radiusMeters, d.radiusMeters, 20, 5000),
      maxLocationAgeSeconds: int(
        raw.maxLocationAgeSeconds,
        d.maxLocationAgeSeconds,
        10,
        3600,
      ),
      blockWhenLocationMissing: bool(
        raw.blockWhenLocationMissing,
        d.blockWhenLocationMissing,
      ),
    };
  }
}
