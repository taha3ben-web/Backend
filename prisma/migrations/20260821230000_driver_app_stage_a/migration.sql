-- المرحلة أ: مواءمة الخادم مع تطبيق السائق (flaminGO driver)
--
-- 1) نوعا وثيقة يرفعهما التطبيق فعليًا وكانا يُردّان بـ 400:
--    البطاقة الرمادية والفحص التقني.
-- 2) حالة EXPIRED للوثيقة المعتمدة التي انتهت صلاحيتها.
-- 3) تاريخ الإصدار على الوثيقة (تاريخ الانتهاء كان موجودًا).
--
-- كل العبارات إضافية فقط: لا حذف قيم ولا تعديل صفوف قائمة.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CARTE_GRISE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'TECHNICAL_INSPECTION';

ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "DriverDocument" ADD COLUMN IF NOT EXISTS "issuedAt" TIMESTAMP(3);