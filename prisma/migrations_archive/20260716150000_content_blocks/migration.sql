-- CreateEnum
CREATE TYPE "ContentBlockType" AS ENUM ('ANNOUNCEMENT', 'ONBOARDING', 'FAQ', 'INFO', 'HELP', 'PROMO');

-- CreateEnum
CREATE TYPE "ContentAudience" AS ENUM ('ALL', 'PASSENGER', 'DRIVER');

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "type" "ContentBlockType" NOT NULL DEFAULT 'INFO',
    "audience" "ContentAudience" NOT NULL DEFAULT 'ALL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentBlock_type_audience_isActive_idx" ON "ContentBlock"("type", "audience", "isActive");

-- CreateIndex
CREATE INDEX "ContentBlock_slug_idx" ON "ContentBlock"("slug");

-- CreateIndex
CREATE INDEX "ContentBlock_isActive_idx" ON "ContentBlock"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlock_slug_locale_audience_key" ON "ContentBlock"("slug", "locale", "audience");
