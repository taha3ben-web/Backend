-- تسليم الإشعارات الدائم (durable delivery): حالة + إعادة محاولة أسّية + DLQ.
-- يُعاد استخدام نوع enum "OutboxStatus" القائم (PENDING/DELIVERED/FAILED/DEAD).

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "deliveryStatus" "OutboxStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Notification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Notification" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "lastError" TEXT;

-- Backfill: الإشعارات المُرسلة مسبقًا تُعتبر مُسلّمة (توافق خلفي).
UPDATE "Notification" SET "deliveryStatus" = 'DELIVERED' WHERE "sentAt" IS NOT NULL;

-- Backfill: الإشعارات غير المُرسلة تصبح مستحقة للتسليم فورًا أو في موعدها المجدول.
UPDATE "Notification" SET "nextAttemptAt" = COALESCE("scheduledAt", "createdAt") WHERE "sentAt" IS NULL;

-- CreateIndex
CREATE INDEX "Notification_deliveryStatus_nextAttemptAt_idx" ON "Notification"("deliveryStatus", "nextAttemptAt");
