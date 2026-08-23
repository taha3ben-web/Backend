-- Stage 65: driver cancellation abuse sanctions. Additive nullable/defaulted columns + history table (safe).

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "cancellationStrikes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Driver" ADD COLUMN "lastSanctionAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DriverSanction" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "cancellationCount" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "suspendedUntil" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverSanction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverSanction_driverId_idx" ON "DriverSanction"("driverId");

-- CreateIndex
CREATE INDEX "DriverSanction_createdAt_idx" ON "DriverSanction"("createdAt");

-- AddForeignKey
ALTER TABLE "DriverSanction" ADD CONSTRAINT "DriverSanction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
