/**
 * حلّ نسبة عمولة المنصّة — منطق نقي بلا قاعدة بيانات أو NestJS.
 *
 * ===== لماذا هذا الملف موجود =====
 * نسبة العمولة قرار تجاري بحت. قبل هذا التصحيح كانت تأتي من مكانين:
 * قاعدة سعر المركبة (`VehiclePricingRule.commissionPct`) وإلّا ثابت مبرمَج
 * `DEFAULT_COMMISSION_PCT = 15` داخل محرك التسعير. الثابت المبرمَج يعني أن
 * تغيير العمولة يحتاج نشر إصدار جديد للخادم، وأن الرقم الحقيقي غير مرئي
 * في أي شاشة إدارة — وهذا ما يمنعه نموذج العمل صراحةً.
 *
 * ===== الحلّ الحتمي (deterministic) =====
 * كل بُعد في القاعدة يقبل null بمعنى «أي قيمة» (wildcard). القاعدة المرشّحة
 * هي التي تتطابق كل أبعادها غير الفارغة مع السياق. ثم يُحسم الترتيب بـ:
 *   1. الأولوية `priority` تنازليًا (تجاوز إداري صريح).
 *   2. درجة التخصيص تنازليًا (الأدقّ جغرافيًا ثم الأدقّ مركبيًا).
 *   3. الأقدم إنشاءً، ثم المعرّف — لضمان نتيجة واحدة ثابتة دائمًا.
 *
 * ترتيب أوزان التخصيص يعكس الهرم المطلوب: دولة ← مدينة ← نوع ← فئة، مع
 * تغليب البُعد الجغرافي على البُعد المركبي، لأن تسعير النقل يُدار عمليًا
 * بالسوق المحلي أولًا: «الاقتصادي في المدية» يُحكم بقواعد المدية قبل قواعد
 * فئة «اقتصادي» الوطنية.
 */

/** قاعدة عمولة كما تُقرأ من قاعدة البيانات (الحد الأدنى المطلوب للحلّ). */
export interface CommissionRuleCandidate {
  id: string;
  countryCode: string | null;
  cityId: string | null;
  vehicleTypeId: string | null;
  vehicleCategoryId: string | null;
  commissionPct: number;
  priority: number;
  isActive: boolean;
  createdAt: Date;
}

/** سياق الرحلة الذي تُحلّ العمولة على أساسه. كله من الخادم، لا من العميل. */
export interface CommissionContext {
  countryCode?: string | null;
  cityId?: string | null;
  vehicleTypeId?: string | null;
  vehicleCategoryId?: string | null;
}

/**
 * أوزان التخصيص. المدينة (8) > الدولة (4) > نوع المركبة (2) > الفئة (1).
 * الأوزان قوى للعدد 2 حتى يكون المجموع تمثيلًا وحيدًا لمجموعة الأبعاد
 * المحدَّدة، فلا يمكن لمجموعتين مختلفتين أن تتساويا في الدرجة.
 */
export const COMMISSION_SPECIFICITY_WEIGHTS = {
  cityId: 8,
  countryCode: 4,
  vehicleTypeId: 2,
  vehicleCategoryId: 1,
} as const;

const normalizeCountry = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

const matchesDimension = (
  ruleValue: string | null,
  contextValue?: string | null,
): boolean => ruleValue === null || ruleValue === (contextValue ?? null);

/** هل تنطبق القاعدة على السياق؟ (null في القاعدة = أي قيمة) */
export function commissionRuleMatches(
  rule: CommissionRuleCandidate,
  ctx: CommissionContext,
): boolean {
  if (!rule.isActive) return false;
  if (
    !matchesDimension(
      normalizeCountry(rule.countryCode),
      normalizeCountry(ctx.countryCode),
    )
  ) {
    return false;
  }
  if (!matchesDimension(rule.cityId, ctx.cityId)) return false;
  if (!matchesDimension(rule.vehicleTypeId, ctx.vehicleTypeId)) return false;
  if (!matchesDimension(rule.vehicleCategoryId, ctx.vehicleCategoryId)) {
    return false;
  }
  return true;
}

/** درجة تخصيص القاعدة — أعلى = أدقّ. */
export function commissionRuleSpecificity(
  rule: CommissionRuleCandidate,
): number {
  return (
    (rule.cityId ? COMMISSION_SPECIFICITY_WEIGHTS.cityId : 0) +
    (normalizeCountry(rule.countryCode)
      ? COMMISSION_SPECIFICITY_WEIGHTS.countryCode
      : 0) +
    (rule.vehicleTypeId ? COMMISSION_SPECIFICITY_WEIGHTS.vehicleTypeId : 0) +
    (rule.vehicleCategoryId
      ? COMMISSION_SPECIFICITY_WEIGHTS.vehicleCategoryId
      : 0)
  );
}

/**
 * يختار القاعدة الفعّالة من مجموعة قواعد. يُرجع null إن لم تنطبق أي قاعدة —
 * ولا يخترع نسبة افتراضية إطلاقًا. قرار ما يحدث عند غياب القاعدة يعيش في
 * `CommissionService` (تراجع إلى تجاوز قاعدة السعر ثم إعداد اللوحة ثم خطأ
 * نطاق واضح)، وليس هنا.
 */
export function pickCommissionRule(
  rules: CommissionRuleCandidate[],
  ctx: CommissionContext,
): CommissionRuleCandidate | null {
  const candidates = rules.filter((rule) => commissionRuleMatches(rule, ctx));
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      commissionRuleSpecificity(b) - commissionRuleSpecificity(a) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

/** هل النسبة قيمة عمولة مقبولة؟ (0..100، رقم منتهٍ) */
export function isValidCommissionPct(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}
