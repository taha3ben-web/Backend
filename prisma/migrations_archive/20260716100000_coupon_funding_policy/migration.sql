-- CreateEnum
CREATE TYPE "CouponFundingSource" AS ENUM ('PLATFORM', 'DRIVER', 'SHARED');

-- AlterTable: per-coupon funding policy override (NULL = use global dashboard default)
ALTER TABLE "Coupon" ADD COLUMN "fundingSource" "CouponFundingSource";
ALTER TABLE "Coupon" ADD COLUMN "platformShare" DECIMAL(5,4);

-- AlterTable: funding policy resolved & captured on the trip at request time
ALTER TABLE "Trip" ADD COLUMN "couponFundingSource" "CouponFundingSource";
ALTER TABLE "Trip" ADD COLUMN "couponPlatformShare" DECIMAL(5,4);
