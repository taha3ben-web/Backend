-- Immutable history for every published client configuration revision.
CREATE TABLE "SettingRevision" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "settingId" TEXT NOT NULL,
  "publishedVersion" INTEGER NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "value" JSONB NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'PUBLISH',
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettingRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SettingRevision"
ADD CONSTRAINT "SettingRevision_settingId_fkey"
FOREIGN KEY ("settingId") REFERENCES "Setting"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SettingRevision_settingId_publishedVersion_key"
ON "SettingRevision"("settingId", "publishedVersion");

CREATE INDEX "SettingRevision_settingId_createdAt_idx"
ON "SettingRevision"("settingId", "createdAt");

CREATE INDEX "SettingRevision_publishedById_idx"
ON "SettingRevision"("publishedById");

-- Seed history with the active version created by the previous migration.
INSERT INTO "SettingRevision" (
  "settingId",
  "publishedVersion",
  "sourceVersion",
  "value",
  "action",
  "createdAt"
)
SELECT
  "id",
  "publishedVersion",
  "version",
  "publishedValue",
  'MIGRATION',
  COALESCE("publishedAt", CURRENT_TIMESTAMP)
FROM "Setting"
WHERE
  "publicationStatus" = 'PUBLISHED'
  AND "isPublic" = TRUE
  AND "isSensitive" = FALSE
  AND "publishedValue" IS NOT NULL
  AND "publishedVersion" > 0;
