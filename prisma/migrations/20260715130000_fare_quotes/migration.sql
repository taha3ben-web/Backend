-- Stage 52: FareQuote — negotiated fare quotes (inDrive-style). Additive, standalone table.

-- CreateEnum
CREATE TYPE "FareQuoteStatus" AS ENUM ('QUOTED', 'PROPOSED', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FareQuote" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "rideClass" "RideClass" NOT NULL DEFAULT 'ECONOMY',
    "vehicleTypeId" TEXT,
    "cityId" TEXT,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT,
    "destLat" DOUBLE PRECISION,
    "destLng" DOUBLE PRECISION,
    "destAddress" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "durationSec" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "suggestedFare" DECIMAL(12,2) NOT NULL,
    "minFare" DECIMAL(12,2) NOT NULL,
    "maxFare" DECIMAL(12,2) NOT NULL,
    "proposedFare" DECIMAL(12,2),
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "pricingSource" TEXT,
    "pricingRuleId" TEXT,
    "status" "FareQuoteStatus" NOT NULL DEFAULT 'QUOTED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "proposedAt" TIMESTAMP(3),
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FareQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FareQuote_passengerId_status_idx" ON "FareQuote"("passengerId", "status");

-- CreateIndex
CREATE INDEX "FareQuote_status_expiresAt_idx" ON "FareQuote"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "FareQuote_createdAt_idx" ON "FareQuote"("createdAt");
