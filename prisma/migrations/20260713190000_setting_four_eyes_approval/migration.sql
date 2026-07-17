CREATE TYPE "SettingChangeRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "SettingChangeRequest" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "settingId" TEXT NOT NULL,
  "requestedValue" JSONB NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "requestType" TEXT NOT NULL DEFAULT 'UPDATE',
  "rollbackFromVersion" INTEGER,
  "status" "SettingChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "SettingChangeRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SettingChangeRequest" ADD CONSTRAINT "SettingChangeRequest_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "Setting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettingChangeRequest" ADD CONSTRAINT "SettingChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettingChangeRequest" ADD CONSTRAINT "SettingChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SettingChangeRequest_settingId_status_idx" ON "SettingChangeRequest"("settingId", "status");
CREATE INDEX "SettingChangeRequest_status_createdAt_idx" ON "SettingChangeRequest"("status", "createdAt");
CREATE INDEX "SettingChangeRequest_requestedById_idx" ON "SettingChangeRequest"("requestedById");
CREATE INDEX "SettingChangeRequest_reviewedById_idx" ON "SettingChangeRequest"("reviewedById");
CREATE UNIQUE INDEX "SettingChangeRequest_one_pending_per_setting" ON "SettingChangeRequest"("settingId") WHERE "status" = 'PENDING';
