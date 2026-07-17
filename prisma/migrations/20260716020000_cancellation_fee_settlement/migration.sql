-- Stage 62: passenger cancellation fee ledger settlement tracking. Additive nullable/defaulted columns (safe).

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN "cancellationSettledAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "cancellationSettlementAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "cancellationSettlementError" TEXT;
