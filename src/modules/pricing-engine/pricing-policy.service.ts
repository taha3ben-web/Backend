import { Injectable } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import type {
  CancellationPolicy,
  WaitingPolicy,
} from "./fare-breakdown.util";

/**
 * مفتاح إعدادات رسوم الأجرة في جدول Settings (group = "pricing").
 *
 * لماذا Settings وليس جدولًا جديدًا؟ لأن المطلوب في المرحلة 7 هو **ربط** الرسوم
 * الموجودة أصلًا في fare-breakdown.util.ts بالنظام والتحكم فيها من اللوحة،
 * لا إنشاء نظام تسعير ثانٍ. Settings هو نظام الضبط القائم الذي تديره اللوحة
 * بالفعل (نفس آلية safety.emergency و passenger.tripCommunication)، وله
 * صفحة إعدادات + تدقيق + كاش. أي قيمة رقمية هنا تُضبط من اللوحة فقط ولا
 * توجد أي قيمة سعرية مبرمجة صلبًا في تطبيقَي الراكب والسائق.
 */
export const PRICING_FEES_SETTING_KEY = "pricing.fees";

/** شكل القيمة المخزّنة في المفتاح أعلاه. */
export interface PricingFeesSetting {
  /**
   * رسوم الخدمة (serviceFee): مبلغ ثابت يُضاف لكل رحلة قبل العمولة.
   * 0 = معطّلة. تدخل في قاعدة احتساب العمولة (surcharges في buildFareBreakdown).
   */
  serviceFee: number;
  /** رسوم الانتظار (waitingFee): مجانية حتى freeSeconds ثم لكل دقيقة. */
  waiting: {
    enabled: boolean;
    freeSeconds: number;
    perMinute: number;
    /** سقف اختياري؛ null = بلا سقف. */
    maxCharge: number | null;
  };
  /** رسوم الإلغاء (cancellationFee) حسب مرحلة الرحلة. */
  cancellation: {
    enabled: boolean;
    /** نافذة إلغاء مجانية بعد قبول السائق (ثوانٍ). */
    graceSeconds: number;
    feeAfterAccept: number;
    feeAfterArrival: number;
    /** نسبة الرسم التي تذهب للسائق كتعويض (0..100). */
    driverCompensationPct: number;
  };
}

/**
 * القيم الافتراضية **معطّلة بالكامل** عن قصد (أصفار / enabled=false).
 *
 * السبب: لا نفرض رسومًا على الركاب بقيمة اخترعها الكود. الرسوم تبدأ العمل
 * فقط بعد أن تضبطها الإدارة من لوحة التحكم. وهذا يحافظ أيضًا على توافق
 * السلوك مع ما قبل المرحلة 7 (حيث كانت الرسوم غير مستعملة إطلاقًا).
 */
export const DEFAULT_PRICING_FEES: PricingFeesSetting = {
  serviceFee: 0,
  waiting: {
    enabled: false,
    freeSeconds: 300,
    perMinute: 0,
    maxCharge: null,
  },
  cancellation: {
    enabled: false,
    graceSeconds: 120,
    feeAfterAccept: 0,
    feeAfterArrival: 0,
    driverCompensationPct: 0,
  },
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * قارئ سياسة رسوم الأجرة من الإعدادات.
 *
 * هذه **ليست** محرك تسعير ثانيًا: لا تحسب أجرة ولا تختار قاعدة سعر.
 * وظيفتها الوحيدة تحويل صف Settings الذي تديره اللوحة إلى الأنواع التي
 * تفهمها دوال fare-breakdown.util.ts القائمة (WaitingPolicy /
 * CancellationPolicy / surcharges)، والتي كانت قبل المرحلة 7 كودًا ميتًا
 * لا يستدعيه أي مسار طلب.
 */
@Injectable()
export class PricingPolicyService {
  constructor(private readonly settings: SettingsService) {}

  /** القيمة الخام بعد التطبيع والتحقق من الحدود. */
  async fees(): Promise<PricingFeesSetting> {
    const raw = await this.settings.getValue<Partial<PricingFeesSetting>>(
      PRICING_FEES_SETTING_KEY,
      DEFAULT_PRICING_FEES,
    );
    return this.normalize(raw);
  }

  normalize(raw?: Partial<PricingFeesSetting> | null): PricingFeesSetting {
    const d = DEFAULT_PRICING_FEES;
    const waiting = raw?.waiting ?? {};
    const cancellation = raw?.cancellation ?? {};
    return {
      serviceFee: num(raw?.serviceFee, d.serviceFee),
      waiting: {
        enabled: bool(waiting.enabled, d.waiting.enabled),
        freeSeconds: Math.round(
          num(waiting.freeSeconds, d.waiting.freeSeconds),
        ),
        perMinute: num(waiting.perMinute, d.waiting.perMinute),
        maxCharge:
          waiting.maxCharge == null
            ? null
            : num(waiting.maxCharge, 0) || null,
      },
      cancellation: {
        enabled: bool(cancellation.enabled, d.cancellation.enabled),
        graceSeconds: Math.round(
          num(cancellation.graceSeconds, d.cancellation.graceSeconds),
        ),
        feeAfterAccept: num(
          cancellation.feeAfterAccept,
          d.cancellation.feeAfterAccept,
        ),
        feeAfterArrival: num(
          cancellation.feeAfterArrival,
          d.cancellation.feeAfterArrival,
        ),
        driverCompensationPct: Math.min(
          100,
          num(
            cancellation.driverCompensationPct,
            d.cancellation.driverCompensationPct,
          ),
        ),
      },
    };
  }

  /** رسوم الخدمة الفعّالة (0 = معطّلة). */
  async serviceFee(): Promise<number> {
    return (await this.fees()).serviceFee;
  }

  /**
   * سياسة الانتظار بالشكل الذي تتوقّعه computeWaitingCharge.
   * تُرجع null عندما تكون الميزة معطّلة أو سعر الدقيقة صفرًا،
   * فلا تُحتسب أي رسوم انتظار إطلاقًا.
   */
  async waitingPolicy(): Promise<WaitingPolicy | null> {
    const { waiting } = await this.fees();
    if (!waiting.enabled || waiting.perMinute <= 0) return null;
    return {
      freeSeconds: waiting.freeSeconds,
      perMinute: waiting.perMinute,
      maxCharge: waiting.maxCharge,
    };
  }

  /**
   * سياسة الإلغاء بالشكل الذي تتوقّعه computeCancellationFee.
   * تُرجع null عندما تكون معطّلة، فيكون رسم الإلغاء صفرًا دائمًا.
   */
  async cancellationPolicy(): Promise<CancellationPolicy | null> {
    const { cancellation } = await this.fees();
    if (!cancellation.enabled) return null;
    if (
      cancellation.feeAfterAccept <= 0 &&
      cancellation.feeAfterArrival <= 0
    ) {
      return null;
    }
    return {
      graceSeconds: cancellation.graceSeconds,
      feeAfterAccept: cancellation.feeAfterAccept,
      feeAfterArrival: cancellation.feeAfterArrival,
      driverCompensationPct: cancellation.driverCompensationPct,
    };
  }
}
