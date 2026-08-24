CREATE TYPE "AccountDeletionStatus" AS ENUM ('PENDING', 'CANCELED', 'COMPLETED', 'REJECTED');

CREATE TABLE "AccountDeletionRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AccountDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "canceledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AccountDeletionRequest_userId_status_idx" ON "AccountDeletionRequest"("userId", "status");
CREATE INDEX "AccountDeletionRequest_status_scheduledFor_idx" ON "AccountDeletionRequest"("status", "scheduledFor");
CREATE UNIQUE INDEX "AccountDeletionRequest_one_pending_per_user" ON "AccountDeletionRequest"("userId") WHERE "status" = 'PENDING';
