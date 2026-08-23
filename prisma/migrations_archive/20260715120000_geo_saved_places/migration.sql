-- Stage 50: Geo/Places — saved places (Home/Work/Recent) as backend source of truth.

-- CreateEnum
CREATE TYPE "SavedPlaceKind" AS ENUM ('HOME', 'WORK', 'RECENT', 'OTHER');

-- CreateTable
CREATE TABLE "SavedPlace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "SavedPlaceKind" NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "placeId" TEXT,
    "meta" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedPlace_userId_kind_idx" ON "SavedPlace"("userId", "kind");

-- CreateIndex
CREATE INDEX "SavedPlace_userId_lastUsedAt_idx" ON "SavedPlace"("userId", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "SavedPlace" ADD CONSTRAINT "SavedPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
