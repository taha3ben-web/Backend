CREATE TABLE "UserNotificationState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserNotificationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserNotificationState_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserNotificationState_userId_notificationId_key" ON "UserNotificationState"("userId", "notificationId");
CREATE INDEX "UserNotificationState_userId_deletedAt_idx" ON "UserNotificationState"("userId", "deletedAt");
CREATE INDEX "UserNotificationState_userId_readAt_idx" ON "UserNotificationState"("userId", "readAt");
