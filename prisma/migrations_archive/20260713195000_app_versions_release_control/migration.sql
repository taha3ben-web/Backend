ALTER TABLE "AppVersion"
ADD COLUMN "appId" TEXT,
ADD COLUMN "clientOs" TEXT,
ADD COLUMN "countryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "releaseChannel" TEXT NOT NULL DEFAULT 'stable',
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "releaseNotes" TEXT,
ADD COLUMN "updateTitle" TEXT,
ADD COLUMN "updateMessage" TEXT,
ADD COLUMN "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "AppVersion_platform_releaseChannel_status_idx"
ON "AppVersion" ("platform", "releaseChannel", "status");

CREATE INDEX "AppVersion_appId_clientOs_idx"
ON "AppVersion" ("appId", "clientOs");
