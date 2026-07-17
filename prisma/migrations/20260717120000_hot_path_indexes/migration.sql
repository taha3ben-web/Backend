-- ضبط فهارس المسارات الساخنة (Hot-path index tuning)
-- مايجريشن غير كاسرة: تضيف فهارس فقط (لا تغيّر أعمدة أو بيانات).
-- تدعم استعلامات رؤية الطابور (المرحلة 74) وصحّة بوّابات الدفع (المرحلة 75).
--
-- ملاحظة تشغيلية: على جداول ضخمة في الإنتاج يُفضّل إنشاء الفهارس بـ
-- CREATE INDEX CONCURRENTLY (خارج معاملة) لتجنّب القفل؛ ونستخدم هنا CREATE INDEX
-- القياسي للتوافق مع سلوك Prisma migrate (معاملة واحدة).

-- CreateIndex
CREATE INDEX "PaymentEvent_createdAt_idx" ON "PaymentEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_deliveredAt_idx" ON "OutboxEvent"("status", "deliveredAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_updatedAt_idx" ON "OutboxEvent"("status", "updatedAt");
