CREATE TYPE "FeatureFlagPlatform" AS ENUM (
  'ALL',
  'PASSENGER',
  'DRIVER',
  'DASHBOARD'
);

CREATE TABLE "FeatureFlag" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "platform" "FeatureFlagPlatform" NOT NULL DEFAULT 'ALL',
  "cityIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlag_rolloutPercentage_check"
    CHECK ("rolloutPercentage" >= 0 AND "rolloutPercentage" <= 100),
  CONSTRAINT "FeatureFlag_schedule_check"
    CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_enabled_platform_idx"
ON "FeatureFlag"("enabled", "platform");
CREATE INDEX "FeatureFlag_startsAt_endsAt_idx"
ON "FeatureFlag"("startsAt", "endsAt");
