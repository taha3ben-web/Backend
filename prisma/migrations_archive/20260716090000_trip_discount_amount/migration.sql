-- Stage 62: coupon discount is borne by the company (deducted from its
-- commission, which may go negative) and credited to the driver as a
-- NON-withdrawable (LOCKED) balance. Snapshot the applied discount per trip so
-- settlement can compute commission on the full (pre-discount) fare and
-- reconstruct the driver-compensation split. Backward compatible: existing rows
-- get NULL (treated as 0 = no coupon), so their settlement is unchanged.
ALTER TABLE "Trip" ADD COLUMN "discountAmount" DECIMAL(12,2);
