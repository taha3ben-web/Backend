-- Stage 50: إزالة العملة الافتراضية المثبّتة بالكود ("DZD") من الجداول المالية.
-- بعد هذه الهجرة يجب أن تُمرَّر العملة صراحةً من طبقة التطبيق (مشتقّة من
-- CountryConfig أو DEFAULT_CURRENCY)، ولن تُحقن أي عملة خاصة بسوق واحد تلقائيًا.
-- الصفوف الحالية لا تتأثّر (تحتفظ بقيم عملتها). DROP DEFAULT آمن ولا يفشل
-- إذا لم يكن هناك افتراض قائم.

ALTER TABLE "Trip" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "PricingRule" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "VehiclePricingRule" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Incentive" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "FareQuote" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "FareOffer" ALTER COLUMN "currency" DROP DEFAULT;
