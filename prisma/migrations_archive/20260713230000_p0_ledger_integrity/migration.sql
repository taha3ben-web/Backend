-- P0: إغلاق النواة المالية — إثراء دفتر الأستاذ + عدم تكرار السحب
-- LedgerTransaction: هوية المنفّذ والسبب القابل للتدقيق
ALTER TABLE "LedgerTransaction" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "LedgerTransaction" ADD COLUMN "reason" TEXT;

-- LedgerEntry: عملة صريحة ودور محاسبي ولقطة رصيد جاري
ALTER TABLE "LedgerEntry" ADD COLUMN "currency" CHAR(3);
ALTER TABLE "LedgerEntry" ADD COLUMN "role" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "balanceAfter" DECIMAL(18,2);

-- WithdrawRequest: مفتاح عدم التكرار (يمنع السحب المزدوج)
ALTER TABLE "WithdrawRequest" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "WithdrawRequest_idempotencyKey_key" ON "WithdrawRequest"("idempotencyKey");
