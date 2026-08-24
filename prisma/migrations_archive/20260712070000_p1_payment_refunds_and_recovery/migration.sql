ALTER TABLE "Payment" ADD COLUMN "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundedAmount_check" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount");
