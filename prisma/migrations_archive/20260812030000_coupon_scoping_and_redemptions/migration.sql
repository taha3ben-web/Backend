-- نطاق الكوبونات + سجل الاسترداد لكل راكب.
-- مكتوب يدويًا بنفس أسلوب الترحيلات القائمة (idempotent)، لأن prisma CLI
-- غير متاح في بيئة العمل هذه. راجِعه بـ `prisma migrate diff` قبل النشر.

-- 1) حدود ونطاق الكوبون على جدول Coupon.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "perUserLimit" INTEGER;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "minFare" DECIMAL(12,2);
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "maxDiscount" DECIMAL(12,2);
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "rideClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "cityId" TEXT;

CREATE INDEX IF NOT EXISTS "Coupon_cityId_idx" ON "Coupon"("cityId");

-- 2) سجل استرداد فعلي: صف لكل استخدام، ليُفرَض perUserLimit ويُلغى عند الإلغاء.
-- tripId فريد ويقبل NULL: الرحلة الواحدة لا تستهلك الكوبون مرتين حتى مع إعادة المحاولة.
CREATE TABLE IF NOT EXISTS "CouponRedemption" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tripId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CouponRedemption_tripId_key"
  ON "CouponRedemption"("tripId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_couponId_userId_idx"
  ON "CouponRedemption"("couponId", "userId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_userId_idx"
  ON "CouponRedemption"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponRedemption_couponId_fkey'
  ) THEN
    ALTER TABLE "CouponRedemption"
      ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId")
      REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) توافق أثر رجعي: الرحلات التي استخدمت كوبونًا قبل وجود السجل، حتى لا يُمنح
-- الركّاب القدامى حدًّا جديدًا مجانًا. يُنفّذ مرة واحدة بفضل ON CONFLICT.
INSERT INTO "CouponRedemption" ("id", "couponId", "userId", "tripId", "createdAt")
SELECT
  gen_random_uuid()::TEXT,
  t."couponId",
  t."passengerId",
  t."id",
  t."createdAt"
FROM "Trip" t
WHERE t."couponId" IS NOT NULL
ON CONFLICT DO NOTHING;
