-- Trip archive: cold snapshots for old terminal trips.

ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Trip_archivedAt_idx" ON "Trip"("archivedAt");

CREATE TABLE IF NOT EXISTS "TripArchive" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "TripStatus" NOT NULL,
    "currency" TEXT NOT NULL,
    "fare" DECIMAL(12,2),
    "completedAt" TIMESTAMP(3),
    "tripCreatedAt" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "trackingCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TripArchive_tripId_key" ON "TripArchive"("tripId");
CREATE INDEX IF NOT EXISTS "TripArchive_passengerId_completedAt_idx" ON "TripArchive"("passengerId", "completedAt");
CREATE INDEX IF NOT EXISTS "TripArchive_driverId_completedAt_idx" ON "TripArchive"("driverId", "completedAt");
CREATE INDEX IF NOT EXISTS "TripArchive_archivedAt_idx" ON "TripArchive"("archivedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'TripArchive_tripId_fkey'
    ) THEN
        ALTER TABLE "TripArchive"
            ADD CONSTRAINT "TripArchive_tripId_fkey"
            FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
