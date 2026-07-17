-- CreateEnum
CREATE TYPE "MessageTemplateCategory" AS ENUM ('TRANSACTIONAL', 'MARKETING', 'SYSTEM', 'SUPPORT');

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "MessageTemplateCategory" NOT NULL DEFAULT 'TRANSACTIONAL',
    "channel" "NotificationChannel",
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageTemplate_key_idx" ON "MessageTemplate"("key");

-- CreateIndex
CREATE INDEX "MessageTemplate_isActive_idx" ON "MessageTemplate"("isActive");

-- CreateIndex
CREATE INDEX "MessageTemplate_category_idx" ON "MessageTemplate"("category");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_key_locale_key" ON "MessageTemplate"("key", "locale");
