DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripTipStatus') THEN
    CREATE TYPE "TripTipStatus" AS ENUM ('PAID', 'REVERSED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "TripTip" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "TripTipStatus" NOT NULL DEFAULT 'PAID',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TripTip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TripTip_tripId_key" ON "TripTip"("tripId");
CREATE INDEX IF NOT EXISTS "TripTip_toUserId_createdAt_idx" ON "TripTip"("toUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "TripTip_fromUserId_createdAt_idx" ON "TripTip"("fromUserId", "createdAt");

ALTER TABLE "TripTip" ADD CONSTRAINT "TripTip_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTip" ADD CONSTRAINT "TripTip_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripTip" ADD CONSTRAINT "TripTip_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
