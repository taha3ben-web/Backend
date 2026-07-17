-- CreateEnum
CREATE TYPE "VehicleVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "verificationStatus" "VehicleVerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Vehicle_verificationStatus_idx" ON "Vehicle"("verificationStatus");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
