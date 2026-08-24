-- Stage 61: passenger cancellation fee support. Additive nullable columns (safe).

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "cancellationFee" DECIMAL(12,2);
