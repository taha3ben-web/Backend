ALTER TABLE "FeatureFlag"
ADD COLUMN "countryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "appIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "clientOs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "audienceSegments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rolloutPlan" JSONB,
ADD COLUMN "minAppVersion" TEXT,
ADD COLUMN "maxAppVersion" TEXT;

CREATE TABLE "FeatureFlagControl" (
  "key" TEXT NOT NULL,
  "globalKillSwitch" BOOLEAN NOT NULL DEFAULT FALSE,
  "globalKillReason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagControl_pkey" PRIMARY KEY ("key")
);

INSERT INTO "FeatureFlagControl" ("key", "globalKillSwitch")
VALUES ('global', FALSE)
ON CONFLICT ("key") DO NOTHING;
