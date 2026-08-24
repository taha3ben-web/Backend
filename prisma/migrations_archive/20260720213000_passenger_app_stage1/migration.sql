CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');
ALTER TABLE "User" ADD COLUMN "gender" "Gender", ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
CREATE TABLE "TranslationBundle" (
  "id" TEXT NOT NULL, "locale" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "messages" JSONB NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT, "updatedById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "TranslationBundle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TranslationBundle_locale_key" ON "TranslationBundle"("locale");
CREATE INDEX "TranslationBundle_isActive_idx" ON "TranslationBundle"("isActive");
