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

// ===========================================================================
// تمويل عمولة المنصّة (نموذج flaminGO) — دوال نقية.
//
// ملاحظة أساسية: **محفظة السائق ليست محفظة أرباح**. إنها رصيد تشغيلي
// مسبق الدفع لتغطية عمولة المنصّة. ولذلك مصادر تسديد العمولة في الرحلة
// الواحدة ثلاثة بترتيب ثابت:
//
//   1. رصيد عمولة الكوبون (COMMISSION_CREDIT) — منفعة ممنوحة سابقًا،
//      تُستهلك أولًا لأنها مخصّصة لهذا الغرض حصرًا ولا استعمال آخر لها.
//   2. المبلغ المُحصَّل إلكترونيًا في هذه الرحلة (flaminGO Pay / بطاقة) —
//      المال بيد المنصّة أصلًا، فاقتطاع العمولة منه لا يحتاج رصيدًا مسبقًا.
//   3. محفظة عمولة السائق — الباقي. هذا هو الجزء الذي يحتاج تغطية مسبقة،
//      وهو كل العمولة في الرحلة النقدية لأن المنصّة لم تُحصّل شيئًا.
// ===========================================================================

export interface CommissionFundingInput {
  /** عمولة المنصّة المستحقّة على الرحلة (من buildFareBreakdown). */
  commissionDue: number;
  /** رصيد عمولة الكوبون المتاح للسائق قبل هذه الرحلة. */
  commissionCreditAvailable: number;
  /** ما حصّلته المنصّة إلكترونيًا في هذه الرحلة (0 للرحلة النقدية). */
  electronicallyCollected: number;
}

export interface CommissionFundingPlan {
  /** المستهلك من رصيد عمولة الكوبون. */
  fromCommissionCredit: number;
  /** المقتطع من المبلغ المُحصَّل إلكترونيًا. */
  fromCollection: number;
  /** المخصوم من محفظة عمولة السائق. */
  fromDriverWallet: number;
}

/**
 * يوزّع عمولة الرحلة على مصادر التسديد بالترتيب الثابت أعلاه.
 * ثابت التوازن: fromCommissionCredit + fromCollection + fromDriverWallet
 *               === round2(commissionDue)
 */
export function planCommissionFunding(
  input: CommissionFundingInput,
): CommissionFundingPlan {
  const due = round2(Math.max(input.commissionDue, 0));
  if (due <= 0) {
    return { fromCommissionCredit: 0, fromCollection: 0, fromDriverWallet: 0 };
  }
  const credit = round2(Math.max(input.commissionCreditAvailable, 0));
  const collected = round2(Math.max(input.electronicallyCollected, 0));

  const fromCommissionCredit = round2(Math.min(credit, due));
  const afterCredit = round2(due - fromCommissionCredit);
  const fromCollection = round2(Math.min(collected, afterCredit));
  const fromDriverWallet = round2(afterCredit - fromCollection);

  return { fromCommissionCredit, fromCollection, fromDriverWallet };
}

/**
 * كم رصيدًا مسبقًا يحتاجه السائق في محفظة العمولة كي يستطيع قبول رحلة؟
 *
 * يُستدعى **قبل** الإسناد (عند قبول العرض) بنفس منطق التسوية، فلا يرى
 * السائق شرطًا وقت القبول يختلف عمّا سيُخصم فعلًا وقت الإنهاء.
 */
export function prepaidCommissionRequirement(input: {
  commissionDue: number;
  commissionCreditAvailable: number;
  /** ما ستُحصّله المنصّة إلكترونيًا (0 إن كانت الرحلة نقدية). */
  electronicallyCollected: number;
}): number {
  return planCommissionFunding(input).fromDriverWallet;
}
