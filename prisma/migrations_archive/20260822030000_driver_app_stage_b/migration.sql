-- المرحلة ب: الولاية عند التسجيل + الصورة الأمامية للمركبة
--
-- 1) السائق يختار الولاية فقط عند التسجيل، فلزم عمود مستقل
--    (cityId يبقى كما هو للتوافق وللتسعير المديني).
-- 2) صورة أمامية للمركبة مكان رخصة النقل VTC.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'VEHICLE_FRONT_PHOTO';

ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "wilayaId" TEXT;

CREATE INDEX IF NOT EXISTS "Driver_wilayaId_idx" ON "Driver"("wilayaId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Driver_wilayaId_fkey'
  ) THEN
    ALTER TABLE "Driver"
      ADD CONSTRAINT "Driver_wilayaId_fkey"
      FOREIGN KEY ("wilayaId") REFERENCES "Wilaya"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ملء الولاية للسائقين الحاليين من مدينتهم إن كانت مربوطة بولاية.
UPDATE "Driver" d
SET "wilayaId" = c."wilayaId"
FROM "City" c
WHERE d."cityId" = c."id"
  AND d."wilayaId" IS NULL
  AND c."wilayaId" IS NOT NULL;
