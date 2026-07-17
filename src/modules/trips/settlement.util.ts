/**
 * تسوية الرحلة ماليًا (دالة نقية) — عمولة الشركة وصافي السائق.
 * قابلة لاختبارات الوحدة دون قاعدة بيانات.
 */

import { round2 } from "../../common/money.util";

export interface Settlement {
  gross: number;
  commission: number;
  net: number;
}

/**
 * @param fare أجرة الرحلة الإجمالية.
 * @param commissionRate نسبة عمولة الشركة (مثال 0.15 = 15%).
 * تُقرّب العمولة والصافي إلى منزلتين عشريتين.
 */
export function computeSettlement(
  fare: number,
  commissionRate: number,
): Settlement {
  const gross = round2(fare);
  const commission = round2(gross * commissionRate);
  const net = round2(gross - commission);
  return { gross, commission, net };
}

export interface LedgerLine {
  direction: "DEBIT" | "CREDIT";
  amount: number;
  accountCode: string;
}

/**
 * اشتقاق أرباح الرحلة من قيود دفتر الأستاذ (مصدر الحقيقة الوحيد) بدل
 * الاعتماد على جداول موازية. gross = مجموع المدين، net = الدائن على حساب
 * المستخدم (رمزه يبدأ بـ "USER:")، commission = الباقي (عمولة المنصة).
 */
export function deriveTripEarnings(lines: LedgerLine[]): Settlement {
  const gross = round2(
    lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + line.amount, 0),
  );
  const net = round2(
    lines
      .filter(
        (line) =>
          line.direction === "CREDIT" && line.accountCode.startsWith("USER:"),
      )
      .reduce((sum, line) => sum + line.amount, 0),
  );
  const commission = round2(gross - net);
  return { gross, commission, net };
}

/** من يتحمّل تكلفة خصم الكوبون (متطابق مع محرّك التسعير). */
export type CouponFundingSource = "PLATFORM" | "DRIVER" | "SHARED";

export interface CouponFundingSplit {
  /** ما تتحمّله الشركة من الخصم. */
  platformFunded: number;
  /** ما يتحمّله السائق من الخصم. */
  driverFunded: number;
}

/**
 * يوزّع خصم الكوبون بين المنصّة والسائق حسب مصدر التمويل
 * المُدار من لوحة التحكم. دالة نقية حتمية تحفظ التوازن:
 * platformFunded + driverFunded === round2(discount).
 *   PLATFORM (الافتراضي): المنصّة تتحمّل الكامل.
 *   DRIVER: السائق يتحمّل الكامل.
 *   SHARED: يُقسّم بحصة platformShare (0..1، الافتراضي 0.5).
 */
export function splitCouponFunding(
  discount: number,
  source: CouponFundingSource | null | undefined,
  platformShare = 0.5,
): CouponFundingSplit {
  const d = round2(Math.max(discount, 0));
  if (d <= 0) return { platformFunded: 0, driverFunded: 0 };
  switch (source) {
    case "DRIVER":
      return { platformFunded: 0, driverFunded: d };
    case "SHARED": {
      const share = Math.min(Math.max(platformShare, 0), 1);
      const platformFunded = round2(d * share);
      return { platformFunded, driverFunded: round2(d - platformFunded) };
    }
    case "PLATFORM":
    default:
      return { platformFunded: d, driverFunded: 0 };
  }
}
