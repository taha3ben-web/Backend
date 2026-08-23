-- PHASE 8 — Geography (Algeria)
-- إنشاء نظام الولايات من الصفر وربطه بالمدن وبالتسعير.
--
-- ملاحظة تصميمية مهمة:
-- هذا الترحيل يُنشئ البنية فقط ولا يحقن الولايات الـ69.
-- لماذا: بيانات الولايات مرجعية متغيّرة (48 ← 58 ← 69 خلال سنوات). حقنها داخل
-- ترحيل يجعلها غير قابلة للتصحيح لاحقًا (الترحيل المطبَّق لا يُعاد تشغيله).
-- لذلك البيانات تُدخَل من prisma/seed.ts بـ upsert قابل لإعادة التشغيل (idempotent).

-- ===================== جدول الولايات =====================

CREATE TABLE "Wilaya" (
  "id"            TEXT NOT NULL,
  "number"        INTEGER NOT NULL,
  "code"          TEXT NOT NULL,
  "nameAr"        TEXT NOT NULL,
  "nameFr"        TEXT NOT NULL,
  "nameEn"        TEXT NOT NULL,
  "seatAr"        TEXT,
  "seatFr"        TEXT,
  "centerLat"     DOUBLE PRECISION,
  "centerLng"     DOUBLE PRECISION,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "isOperational" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Wilaya_pkey" PRIMARY KEY ("id")
);

-- الرقم والـcode كلاهما معرّف طبيعي: الرقم هو المتداول وطنيًا، والـcode للتكامل الخارجي.
-- وجودهما unique هو ما يجعل الـseed قابلًا لإعادة التشغيل بأمان.
CREATE UNIQUE INDEX "Wilaya_number_key" ON "Wilaya"("number");
CREATE UNIQUE INDEX "Wilaya_code_key"   ON "Wilaya"("code");
CREATE INDEX "Wilaya_isActive_idx"      ON "Wilaya"("isActive");
CREATE INDEX "Wilaya_isOperational_idx" ON "Wilaya"("isOperational");

-- ===================== ربط المدن بالولايات =====================
-- العمود NULL-able عمدًا: المدن الموجودة قبل المرحلة 8 لا تملك ولاية،
-- وجعله NOT NULL كان سيفشل الترحيل على قاعدة بيانات فيها مدن أصلًا.
-- ON DELETE SET NULL: حذف ولاية لا يجوز أن يحذف مدنًا ولا رحلات مرتبطة بها.
ALTER TABLE "City" ADD COLUMN "wilayaId" TEXT;

ALTER TABLE "City"
  ADD CONSTRAINT "City_wilayaId_fkey"
  FOREIGN KEY ("wilayaId") REFERENCES "Wilaya"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "City_wilayaId_idx" ON "City"("wilayaId");

-- ===================== ربط التسعير بالولايات =====================
-- محرك التسعير (PricingRule) — نطاق جديد بين "المدينة" و"وطني".
ALTER TABLE "PricingRule" ADD COLUMN "wilayaId" TEXT;

ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_wilayaId_fkey"
  FOREIGN KEY ("wilayaId") REFERENCES "Wilaya"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PricingRule_wilayaId_idx" ON "PricingRule"("wilayaId");

-- يخدم resolveLegacy(): البحث دائمًا بـ (rideClass, isActive) ثم ترشيح النطاق.
CREATE INDEX "PricingRule_rideClass_isActive_idx" ON "PricingRule"("rideClass", "isActive");

-- التسعير الديناميكي (VehiclePricingRule) — يستبدل حقل "state" النصي الحر.
-- لا نحذف "state" في هذا الترحيل: قد توجد قواعد منشورة تعتمد عليه، وحذفه
-- قبل ترحيل البيانات يعني فقدانًا صامتًا للنطاق. يُحذف في مرحلة تالية بعد التأكد.
ALTER TABLE "VehiclePricingRule" ADD COLUMN "wilayaId" TEXT;

ALTER TABLE "VehiclePricingRule"
  ADD CONSTRAINT "VehiclePricingRule_wilayaId_fkey"
  FOREIGN KEY ("wilayaId") REFERENCES "Wilaya"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VehiclePricingRule_wilayaId_idx" ON "VehiclePricingRule"("wilayaId");
