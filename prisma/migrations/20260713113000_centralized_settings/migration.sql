-- Centralized, versioned application configuration.
ALTER TABLE "Setting"
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "isSensitive" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Setting_group_idx" ON "Setting"("group");
CREATE INDEX "Setting_isPublic_isSensitive_idx"
ON "Setting"("isPublic", "isSensitive");

ALTER TABLE "City"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Zone"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing client-safe settings become available to passenger/driver apps.
UPDATE "Setting"
SET "isPublic" = TRUE
WHERE "key" IN (
  'app.general',
  'app.theme',
  'app.legal',
  'integrations.maps',
  'integrations.notifications'
);

-- Integration credentials remain private and are masked in admin responses.
UPDATE "Setting"
SET "isSensitive" = TRUE, "isPublic" = FALSE
WHERE "key" IN (
  'integrations.firebase',
  'integrations.email',
  'integrations.sms'
);
