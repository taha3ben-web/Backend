-- Stage 49: notification media (image + deep link) controllable from dashboard
ALTER TABLE "Notification" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN "deepLink" TEXT;
