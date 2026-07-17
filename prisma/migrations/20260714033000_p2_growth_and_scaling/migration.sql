-- P2: جدولة وتوقفات متعددة + SLA للدعم + تسوية بنكية + حوافز/تجارب A/B + ضوابط توسّع المدن

-- AlterEnum: إضافة حالة رحلة مجدولة
ALTER TYPE "TripStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'LOW');
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELED');
CREATE TYPE "PayoutItemStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');
CREATE TYPE "IncentiveKind" AS ENUM ('TRIP_COUNT', 'EARNINGS_THRESHOLD', 'ACCEPTANCE_RATE', 'STREAK_DAYS');
CREATE TYPE "CityLaunchStatus" AS ENUM ('PLANNED', 'PILOT', 'LIVE', 'PAUSED');

-- AlterTable: Trip (جدولة)
ALTER TABLE "Trip" ADD COLUMN "isScheduled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Trip" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "dispatchAt" TIMESTAMP(3);

-- AlterTable: SupportTicket (SLA/تصعيد/رمز حلّ)
ALTER TABLE "SupportTicket" ADD COLUMN "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "SupportTicket" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "slaDueAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "resolutionCode" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupportTicket" ADD COLUMN "breached" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "withdrawRequestId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "iban" TEXT,
    "bankRef" TEXT,
    "status" "PayoutItemStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incentive" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "IncentiveKind" NOT NULL,
    "cityId" TEXT,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "rewardMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'DZD',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverIncentiveProgress" (
    "id" TEXT NOT NULL,
    "incentiveId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    "rewardMinor" INTEGER NOT NULL DEFAULT 0,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverIncentiveProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingExperiment" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variants" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CityScalingControl" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "launchStatus" "CityLaunchStatus" NOT NULL DEFAULT 'PLANNED',
    "maxActiveDrivers" INTEGER,
    "maxDailyTrips" INTEGER,
    "enabledRideClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "surgeCap" DOUBLE PRECISION,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityScalingControl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status", "priority");
CREATE INDEX "SupportTicket_assigneeId_idx" ON "SupportTicket"("assigneeId");
CREATE INDEX "SupportTicket_slaDueAt_idx" ON "SupportTicket"("slaDueAt");
CREATE UNIQUE INDEX "TripStop_tripId_seq_key" ON "TripStop"("tripId", "seq");
CREATE INDEX "TripStop_tripId_idx" ON "TripStop"("tripId");
CREATE UNIQUE INDEX "PayoutBatch_reference_key" ON "PayoutBatch"("reference");
CREATE INDEX "PayoutBatch_status_createdAt_idx" ON "PayoutBatch"("status", "createdAt");
CREATE INDEX "PayoutBatch_provider_status_idx" ON "PayoutBatch"("provider", "status");
CREATE INDEX "PayoutItem_batchId_idx" ON "PayoutItem"("batchId");
CREATE INDEX "PayoutItem_driverId_idx" ON "PayoutItem"("driverId");
CREATE INDEX "Incentive_active_startsAt_endsAt_idx" ON "Incentive"("active", "startsAt", "endsAt");
CREATE INDEX "Incentive_cityId_idx" ON "Incentive"("cityId");
CREATE UNIQUE INDEX "DriverIncentiveProgress_incentiveId_driverId_key" ON "DriverIncentiveProgress"("incentiveId", "driverId");
CREATE INDEX "DriverIncentiveProgress_driverId_idx" ON "DriverIncentiveProgress"("driverId");
CREATE UNIQUE INDEX "PricingExperiment_key_key" ON "PricingExperiment"("key");
CREATE INDEX "PricingExperiment_active_idx" ON "PricingExperiment"("active");
CREATE UNIQUE INDEX "ExperimentAssignment_experimentId_subjectId_key" ON "ExperimentAssignment"("experimentId", "subjectId");
CREATE INDEX "ExperimentAssignment_experimentId_variant_idx" ON "ExperimentAssignment"("experimentId", "variant");
CREATE UNIQUE INDEX "CityScalingControl_cityId_key" ON "CityScalingControl"("cityId");
CREATE INDEX "CityScalingControl_launchStatus_idx" ON "CityScalingControl"("launchStatus");

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverIncentiveProgress" ADD CONSTRAINT "DriverIncentiveProgress_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "Incentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "PricingExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
