-- Stage 53: FareOffer — driver counter-offers / bidding on FareQuote (inDrive-style). Additive, standalone table.

-- CreateEnum
CREATE TYPE "FareOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateTable
CREATE TABLE "FareOffer" (
    "id" TEXT NOT NULL,
    "fareQuoteId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "note" TEXT,
    "etaMinutes" INTEGER,
    "status" "FareOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FareOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FareOffer_fareQuoteId_status_idx" ON "FareOffer"("fareQuoteId", "status");

-- CreateIndex
CREATE INDEX "FareOffer_driverId_status_idx" ON "FareOffer"("driverId", "status");

-- CreateIndex
CREATE INDEX "FareOffer_createdAt_idx" ON "FareOffer"("createdAt");
