-- PHASE 6 — Communication
-- حالة القراءة لرسائل الرحلة.
--
-- لماذا عمود على TripMessage وليس جدول قراءات منفصل: محادثة الرحلة ثنائية
-- الأطراف حصرًا (راكب واحد + سائق واحد)، فالمستقبِل معروف ضمنًا بأنه الطرف
-- الذي ليس senderId. جدول قراءات كان سيضيف JOIN على أسخن استعلام في المحادثة
-- دون أي معلومة إضافية.
--
-- الرسائل التاريخية تبقى readAt = NULL. هذا مقصود: لا نعرف إن كانت قُرئت
-- فعلًا، ولا نزوّر حالة قراءة. عدّاد "غير المقروء" محسوب دائمًا على الرسائل
-- الواردة من الطرف الآخر فقط، ورحلات الماضي مغلقة أصلًا فلا تظهر كشارة.

ALTER TABLE "TripMessage" ADD COLUMN "readAt" TIMESTAMP(3);

-- يخدم عدّاد غير المقروء: (tripId, senderId, readAt IS NULL).
CREATE INDEX "TripMessage_tripId_senderId_readAt_idx"
  ON "TripMessage"("tripId", "senderId", "readAt");
