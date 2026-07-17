-- Country Config (Multi-Country)

-- CreateEnum
CREATE TYPE "CountryTaxMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

-- CreateTable
CREATE TABLE "CountryConfig" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "dialCode" TEXT NOT NULL,
    "nationalNumberLength" INTEGER NOT NULL DEFAULT 9,
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxMode" "CountryTaxMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryConfig_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "CountryConfig_isActive_idx" ON "CountryConfig"("isActive");
