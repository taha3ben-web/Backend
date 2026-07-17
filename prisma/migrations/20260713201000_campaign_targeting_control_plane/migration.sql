ALTER TABLE "Notification"
ADD COLUMN "campaignKey" TEXT,
ADD COLUMN "appId" TEXT,
ADD COLUMN "clientOs" TEXT,
ADD COLUMN "countryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "localeCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "driverCityIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "sentCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Notification_campaignKey_idx" ON "Notification" ("campaignKey");

ALTER TABLE "Advertisement"
ADD COLUMN "campaignKey" TEXT,
ADD COLUMN "appId" TEXT,
ADD COLUMN "clientOs" TEXT,
ADD COLUMN "countryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "audienceSegments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Advertisement_campaignKey_idx" ON "Advertisement" ("campaignKey");
