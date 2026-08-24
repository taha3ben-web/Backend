-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RETRYING', 'FAILED', 'POSTED');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- Backfill existing trips so the settlement state machine is consistent with history
UPDATE "Trip" SET "settlementStatus" = 'POSTED' WHERE "settledAt" IS NOT NULL;
UPDATE "Trip" SET "settlementStatus" = 'FAILED' WHERE "settledAt" IS NULL AND "status" = 'COMPLETED' AND "settlementError" IS NOT NULL;
UPDATE "Trip" SET "settlementStatus" = 'PENDING' WHERE "settledAt" IS NULL AND "status" = 'COMPLETED' AND "settlementError" IS NULL;

-- CreateIndex
CREATE INDEX "Trip_settlementStatus_idx" ON "Trip"("settlementStatus");
