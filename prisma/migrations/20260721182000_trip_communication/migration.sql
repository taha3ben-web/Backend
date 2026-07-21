CREATE TABLE "TripMessage" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripMessage_tripId_createdAt_idx" ON "TripMessage"("tripId", "createdAt");
CREATE INDEX "TripMessage_senderId_createdAt_idx" ON "TripMessage"("senderId", "createdAt");
ALTER TABLE "TripMessage" ADD CONSTRAINT "TripMessage_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripMessage" ADD CONSTRAINT "TripMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
