-- المفقودات: أغراض يتركها الركّاب في السيارة.
CREATE TYPE "LostItemStatus" AS ENUM ('OPEN', 'DRIVER_NOTIFIED', 'FOUND', 'RETURNED', 'NOT_FOUND', 'CLOSED');

CREATE TABLE "LostItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "status" "LostItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contactPhone" TEXT,
    "photoUrl" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LostItem_status_createdAt_idx" ON "LostItem"("status", "createdAt");
CREATE INDEX "LostItem_tripId_idx" ON "LostItem"("tripId");
CREATE INDEX "LostItem_reporterId_createdAt_idx" ON "LostItem"("reporterId", "createdAt");

ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
