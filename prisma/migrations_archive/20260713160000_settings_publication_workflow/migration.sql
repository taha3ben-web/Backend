-- Add a controlled draft/publish workflow for client-facing configuration.
CREATE TYPE "SettingPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "Setting"
ADD COLUMN "publishedValue" JSONB,
ADD COLUMN "publicationStatus" "SettingPublicationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "publishedVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Preserve the currently active configuration during migration.
UPDATE "Setting"
SET
  "publishedValue" = CASE
    WHEN "isPublic" = TRUE AND "isSensitive" = FALSE THEN "value"
    ELSE NULL
  END,
  "publicationStatus" = 'PUBLISHED',
  "publishedVersion" = CASE
    WHEN "isPublic" = TRUE AND "isSensitive" = FALSE THEN "version"
    ELSE 0
  END,
  "publishedAt" = CASE
    WHEN "isPublic" = TRUE AND "isSensitive" = FALSE THEN CURRENT_TIMESTAMP
    ELSE NULL
  END;

CREATE INDEX "Setting_publicationStatus_isPublic_isSensitive_idx"
ON "Setting"("publicationStatus", "isPublic", "isSensitive");
