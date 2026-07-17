-- CreateEnum
CREATE TYPE "IdentityDocType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'RESIDENCE_PERMIT');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "UserIdentityVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docType" "IdentityDocType" NOT NULL,
    "docNumber" TEXT,
    "frontUrl" TEXT NOT NULL,
    "backUrl" TEXT,
    "selfieUrl" TEXT,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserIdentityVerification_userId_idx" ON "UserIdentityVerification"("userId");

-- CreateIndex
CREATE INDEX "UserIdentityVerification_status_idx" ON "UserIdentityVerification"("status");

-- AddForeignKey
ALTER TABLE "UserIdentityVerification" ADD CONSTRAINT "UserIdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityVerification" ADD CONSTRAINT "UserIdentityVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
