-- بيانات التحويل البنكي للسائق: تُستخدم عند بناء دفعات الصرف (Payout Batches).
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "payoutIban" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "payoutBankName" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "payoutAccountHolder" TEXT;
