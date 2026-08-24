-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "LedgerReconciliationIncident" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "cachedBalance" DECIMAL(18,2) NOT NULL,
    "derivedBalance" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerReconciliationIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerReconciliationIncident_status_createdAt_idx" ON "LedgerReconciliationIncident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerReconciliationIncident_accountId_idx" ON "LedgerReconciliationIncident"("accountId");
