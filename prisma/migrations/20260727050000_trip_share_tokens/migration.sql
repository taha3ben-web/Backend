-- روابط مشاركة الرحلة (Share my trip) — رموز مؤقّتة تُخزّن مجزّأة.
CREATE TABLE "TripShareToken" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripShareToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripShareToken_tokenHash_key" ON "TripShareToken"("tokenHash");
CREATE INDEX "TripShareToken_tripId_expiresAt_idx" ON "TripShareToken"("tripId", "expiresAt");

ALTER TABLE "TripShareToken" ADD CONSTRAINT "TripShareToken_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
