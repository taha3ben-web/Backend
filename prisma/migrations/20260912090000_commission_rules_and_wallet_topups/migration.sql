-- ============================================================================
-- تصحيح نموذج العمل المالي: عمولة مُدارة من اللوحة + شحن المحافظ
--
-- غير مُدمّر بالكامل: لا حذف أعمدة، لا حذف صفوف، لا إعادة تعيين.
-- كل ما يجري هنا: إسقاط قيم افتراضية مبرمَجة، إضافة أعمدة اختيارية،
-- وإنشاء جداول جديدة.
-- ============================================================================

-- 1) Trip.commissionPct: إسقاط القيمة الافتراضية المبرمَجة (15).
--
--    لماذا: نسبة العمولة قرار تجاري يُضبط من لوحة التحكم، ووجود DEFAULT 15
--    في المخطط يعني أن أي مسار ينسى تمرير النسبة يحصل على 15% مبرمَجة
--    بصمت. بعد هذا التغيير يجب على كل مسار إنشاء رحلة أن يحلّ النسبة
--    صراحةً من الإعدادات. العمود يبقى NOT NULL لأن كل رحلة **لازم** أن
--    تحمل لقطة النسبة المستخدمة وقت إنشائها (سجل تاريخي لا يُعاد حسابه).
--    الصفوف الحالية لا تتغير: قيمها المخزَّنة تبقى كما هي.
ALTER TABLE "Trip" ALTER COLUMN "commissionPct" DROP DEFAULT;

-- 2) Trip.commissionRuleId: أثر تدقيق لقاعدة العمولة التي حُلّت منها النسبة.
--    اختياري (null للرحلات التاريخية ولحالات التراجع إلى إعداد عام).
ALTER TABLE "Trip" ADD COLUMN "commissionRuleId" TEXT;
CREATE INDEX "Trip_commissionRuleId_idx" ON "Trip"("commissionRuleId");

-- 3) VehiclePricingRule.commissionPct: إسقاط DEFAULT 15 وجعله اختياريًا.
--    يبقى كتجاوز اختياري لكل قاعدة سعر، لكنه لم يعد يحمل نسبة مبرمَجة،
--    و null تعني «لا تجاوز — استعمل CommissionRule».
--    الصفوف الحالية تحفظ قيمها (بما فيها 15 التي ضُبطت سابقًا).
ALTER TABLE "VehiclePricingRule" ALTER COLUMN "commissionPct" DROP DEFAULT;
ALTER TABLE "VehiclePricingRule" ALTER COLUMN "commissionPct" DROP NOT NULL;

-- 4) قواعد العمولة المُدارة من اللوحة (دولة ← مدينة ← نوع ← فئة).
--    لا يُدرج أي صف هنا: أي نسبة مُدرجة في مايغريشن تكون نسبة مبرمَجة.
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "countryCode" TEXT,
    "cityId" TEXT,
    "vehicleTypeId" TEXT,
    "vehicleCategoryId" TEXT,
    "commissionPct" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionRule_isActive_idx" ON "CommissionRule"("isActive");
CREATE INDEX "CommissionRule_countryCode_cityId_idx" ON "CommissionRule"("countryCode", "cityId");
CREATE INDEX "CommissionRule_vehicleTypeId_idx" ON "CommissionRule"("vehicleTypeId");
CREATE INDEX "CommissionRule_vehicleCategoryId_idx" ON "CommissionRule"("vehicleCategoryId");
CREATE INDEX "CommissionRule_priority_idx" ON "CommissionRule"("priority");

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_vehicleTypeId_fkey"
    FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_vehicleCategoryId_fkey"
    FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_commissionRuleId_fkey"
    FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) شحن المحفظة (Top-up) — راكب (flaminGO Pay) وسائق (محفظة العمولة).
CREATE TYPE "WalletTopUpStatus" AS ENUM ('PENDING', 'CAPTURED', 'FAILED', 'CANCELED');

CREATE TABLE "WalletTopUp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "providerStatus" TEXT,
    "status" "WalletTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "capturedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTopUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletTopUp_idempotencyKey_key" ON "WalletTopUp"("idempotencyKey");
CREATE INDEX "WalletTopUp_userId_createdAt_idx" ON "WalletTopUp"("userId", "createdAt");
CREATE INDEX "WalletTopUp_status_createdAt_idx" ON "WalletTopUp"("status", "createdAt");
CREATE INDEX "WalletTopUp_provider_providerPaymentId_idx" ON "WalletTopUp"("provider", "providerPaymentId");

CREATE TABLE "WalletTopUpEvent" (
    "id" TEXT NOT NULL,
    "topUpId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "provider" TEXT,
    "idempotencyKey" TEXT,
    "reference" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTopUpEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletTopUpEvent_idempotencyKey_key" ON "WalletTopUpEvent"("idempotencyKey");
CREATE INDEX "WalletTopUpEvent_topUpId_createdAt_idx" ON "WalletTopUpEvent"("topUpId", "createdAt");
CREATE INDEX "WalletTopUpEvent_type_createdAt_idx" ON "WalletTopUpEvent"("type", "createdAt");

ALTER TABLE "WalletTopUp" ADD CONSTRAINT "WalletTopUp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTopUpEvent" ADD CONSTRAINT "WalletTopUpEvent_topUpId_fkey"
    FOREIGN KEY ("topUpId") REFERENCES "WalletTopUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6) FareQuote.commissionPct: نفس علّة Trip — إسقاط DEFAULT 15 المبرمَج،
--    وإضافة أثر تدقيق لقاعدة العمولة. العمود يبقى NOT NULL لأن كل عرض سعر
--    لازم أن يحمل لقطة النسبة التي عُرضت على الراكب والسائق.
ALTER TABLE "FareQuote" ALTER COLUMN "commissionPct" DROP DEFAULT;
ALTER TABLE "FareQuote" ADD COLUMN "commissionRuleId" TEXT;
