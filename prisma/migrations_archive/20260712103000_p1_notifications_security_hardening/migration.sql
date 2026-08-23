DO $$ BEGIN
  CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "templateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "variables" JSONB,
  ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "sentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

UPDATE "Notification"
SET
  "status" = CASE WHEN "sentAt" IS NOT NULL THEN 'SENT'::"NotificationDeliveryStatus" ELSE 'PENDING'::"NotificationDeliveryStatus" END,
  "nextAttemptAt" = COALESCE("nextAttemptAt", "scheduledAt", "createdAt"),
  "sentCount" = CASE WHEN "sentAt" IS NOT NULL THEN GREATEST("sentCount", 1) ELSE "sentCount" END;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "Notification_templateKey_idx" ON "Notification"("templateKey");

CREATE TABLE IF NOT EXISTS "NotificationTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL DEFAULT 'PUSH',
  "titleTemplate" TEXT NOT NULL,
  "bodyTemplate" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationTemplate_key_key" ON "NotificationTemplate"("key");

ALTER TABLE "RefreshToken"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "deviceKey" TEXT,
  ADD COLUMN IF NOT EXISTS "installationId" TEXT,
  ADD COLUMN IF NOT EXISTS "platform" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceName" TEXT,
  ADD COLUMN IF NOT EXISTS "appVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokeReason" TEXT;

CREATE INDEX IF NOT EXISTS "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
CREATE INDEX IF NOT EXISTS "Session_revokedAt_idx" ON "Session"("revokedAt");
CREATE INDEX IF NOT EXISTS "Session_deviceKey_idx" ON "Session"("deviceKey");

DO $$ BEGIN
  ALTER TABLE "RefreshToken"
    ADD CONSTRAINT "RefreshToken_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
