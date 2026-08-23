CREATE TYPE "SafetyIncidentType" AS ENUM ('SOS', 'ACCIDENT', 'THREAT', 'MEDICAL', 'OTHER');
CREATE TYPE "SafetyIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');

CREATE TABLE "SafetyIncident" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tripId" TEXT,
  "type" "SafetyIncidentType" NOT NULL DEFAULT 'SOS',
  "status" "SafetyIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "message" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafetyIncident_idempotencyKey_key" ON "SafetyIncident"("idempotencyKey");
CREATE INDEX "SafetyIncident_status_createdAt_idx" ON "SafetyIncident"("status", "createdAt");
CREATE INDEX "SafetyIncident_tripId_idx" ON "SafetyIncident"("tripId");
CREATE INDEX "SafetyIncident_userId_createdAt_idx" ON "SafetyIncident"("userId", "createdAt");

ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
