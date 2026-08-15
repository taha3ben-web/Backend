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
  /**
   * حدود التفاوض (المرحلة 7): عرض النطاق حول السعر المقترَح.
   * 0.2 = ±20٪، 0 = لا تفاوض. نفس دلالة NegotiationDto في لوحة التحكم.
   */
  negotiation: {
    bandPct: number;
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
  /**
   * الافتراضي يطابق السلوك القائم فعليًا في FareQuotesService
   * (FARE_QUOTE_BAND_PCT وافتراضه 0.2)، فلا يتغير نطاق التفاوض
   * المعروض للراكب بمجرد إضافة المفتاح للإعدادات.
   */
  negotiation: {
    bandPct: 0.2,
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
    return normalizePricingFees(raw);
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
    return waitingPolicyFrom(await this.fees());
  }

  /**
   * سياسة الإلغاء بالشكل الذي تتوقّعه computeCancellationFee.
   * تُرجع null عندما تكون معطّلة، فيكون رسم الإلغاء صفرًا دائمًا.
   */
  async cancellationPolicy(): Promise<CancellationPolicy | null> {
    return cancellationPolicyFrom(await this.fees());
  }
}

/**
 * التطبيع كدالة نقية (بلا DI ولا قاعدة بيانات) ليمكن للوحدة المالية
 * استعمال **نفس** منطق التطبيع الذي يستعمله محرك التسعير دون تكرار
 * ودون اعتماد دائري بين الوحدتين. PricingPolicyService.normalize() يفوّض إليها.
 */
export function normalizePricingFees(
  raw?: Partial<PricingFeesSetting> | null,
): PricingFeesSetting {
  const d = DEFAULT_PRICING_FEES;
  // التصريح بالنوع ضروري: بدونه يُستنتج نوع `?? {}` كـ `{}` فتضيع
  // أسماء الحقول (enabled/freeSeconds/...) من النوع الناتج.
  const waiting: Partial<PricingFeesSetting["waiting"]> = raw?.waiting ?? {};
  const cancellation: Partial<PricingFeesSetting["cancellation"]> =
    raw?.cancellation ?? {};
  const negotiation: Partial<PricingFeesSetting["negotiation"]> =
    raw?.negotiation ?? {};
  return {
    serviceFee: num(raw?.serviceFee, d.serviceFee),
    waiting: {
      enabled: bool(waiting.enabled, d.waiting.enabled),
      freeSeconds: Math.round(num(waiting.freeSeconds, d.waiting.freeSeconds)),
      perMinute: num(waiting.perMinute, d.waiting.perMinute),
      maxCharge:
        waiting.maxCharge == null ? null : num(waiting.maxCharge, 0) || null,
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
    negotiation: {
      // نفس حدّ NegotiationDto في اللوحة (0..0.9) فلا يوجد مصدر حقيقة ثانٍ.
      bandPct: Math.min(0.9, num(negotiation.bandPct, d.negotiation.bandPct)),
    },
  };
}

/**
 * سياسة الانتظار كدالة نقية بالشكل الذي تتوقّعه computeWaitingCharge.
 *
 * تُرجع null عندما تكون الميزة معطّلة أو سعر الدقيقة صفرًا، فلا تُحتسب أي
 * رسوم انتظار إطلاقًا. هذا هو نفس المنطق الذي كان داخل
 * PricingPolicyService.waitingPolicy() (الذي يفوّض إليها الآن)، فلا يوجد
 * منطق مكرر ولا يحتاج المستدعي (FinancialService) إلى حاقن DI لقراءته.
 */
export function waitingPolicyFrom(
  fees: PricingFeesSetting,
): WaitingPolicy | null {
  const { waiting } = fees;
  if (!waiting.enabled || waiting.perMinute <= 0) return null;
  return {
    freeSeconds: waiting.freeSeconds,
    perMinute: waiting.perMinute,
    maxCharge: waiting.maxCharge,
  };
}

/**
 * سياسة الإلغاء كدالة نقية بالشكل الذي تتوقّعه computeCancellationFee.
 * تُرجع null عندما تكون معطّلة، فيكون رسم الإلغاء صفرًا دائمًا
 * (سلوك المرحلة 10 كما هو: لا رسم على الراكب افتراضيًا).
 */
export function cancellationPolicyFrom(
  fees: PricingFeesSetting,
): CancellationPolicy | null {
  const { cancellation } = fees;
  if (!cancellation.enabled) return null;
  if (cancellation.feeAfterAccept <= 0 && cancellation.feeAfterArrival <= 0) {
    return null;
  }
  return {
    graceSeconds: cancellation.graceSeconds,
    feeAfterAccept: cancellation.feeAfterAccept,
    feeAfterArrival: cancellation.feeAfterArrival,
    driverCompensationPct: cancellation.driverCompensationPct,
  };
}
