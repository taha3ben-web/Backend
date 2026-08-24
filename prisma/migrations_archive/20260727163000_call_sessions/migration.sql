-- جلسات المكالمات المخفية: (رقم وسيط + رقم المتصل) → طرف الوجهة.
CREATE TABLE IF NOT EXISTS "CallSession" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'twilio',
  "proxyNumber" TEXT NOT NULL,
  "callerRole" "ActorKind" NOT NULL,
  "callerPhone" TEXT NOT NULL,
  "calleePhone" TEXT NOT NULL,
  "pin" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastCallAt" TIMESTAMP(3),
  "callCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallSession_proxyNumber_callerPhone_expiresAt_idx"
  ON "CallSession" ("proxyNumber", "callerPhone", "expiresAt");
CREATE INDEX IF NOT EXISTS "CallSession_tripId_callerRole_idx"
  ON "CallSession" ("tripId", "callerRole");
CREATE INDEX IF NOT EXISTS "CallSession_expiresAt_idx"
  ON "CallSession" ("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CallSession_tripId_fkey'
  ) THEN
    ALTER TABLE "CallSession"
      ADD CONSTRAINT "CallSession_tripId_fkey" FOREIGN KEY ("tripId")
      REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
