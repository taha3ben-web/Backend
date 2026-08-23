-- AlterTable: توسيع PromoCode بحقول الاستبدال
ALTER TABLE "PromoCode" ADD COLUMN "currency" TEXT;
ALTER TABLE "PromoCode" ADD COLUMN "maxRedemptions" INTEGER;
ALTER TABLE "PromoCode" ADD COLUMN "redeemedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: سجل استبدال الرموز الترويجية
CREATE TABLE "PromoCodeRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCodeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: قيد فريد يمنع الاستبدال المتكرر لكل مستخدم
CREATE UNIQUE INDEX "PromoCodeRedemption_promoCodeId_userId_key" ON "PromoCodeRedemption"("promoCodeId", "userId");

-- CreateIndex
CREATE INDEX "PromoCodeRedemption_userId_idx" ON "PromoCodeRedemption"("userId");

-- AddForeignKey
ALTER TABLE "PromoCodeRedemption" ADD CONSTRAINT "PromoCodeRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
