-- تحويل TripTracking إلى جدول مُقسّم شهريًا (native range partitioning).
-- السبب: هذا الجدول ينمو أسرع من كل الجداول (نقطة GPS كل بضع ثوانٍ
-- لكل رحلة نشطة)، وحذف القديم بـ DELETE يولّد تضخّمًا (bloat) ويقفل الجدول؛
-- بينما DROP PARTITION فوري وبلا تكلفة.

-- 1) دالة إنشاء قسم شهري عند الطلب (تستدعيها مهمة مجدولة شهريًا).
CREATE OR REPLACE FUNCTION flamingo_ensure_tracking_partition(p_month DATE)
RETURNS TEXT AS $$
DECLARE
  v_start DATE := date_trunc('month', p_month)::DATE;
  v_end   DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::DATE;
  v_name  TEXT := 'TripTracking_' || to_char(v_start, 'YYYYMM');
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "TripTracking" FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end
    );
  END IF;
  RETURN v_name;
END;
$$ LANGUAGE plpgsql;

-- 2) تحويل الجدول القائم دون فقدان بيانات.
ALTER TABLE "TripTracking" RENAME TO "TripTracking_legacy";
ALTER INDEX "TripTracking_pkey" RENAME TO "TripTracking_legacy_pkey";
ALTER INDEX "TripTracking_tripId_recordedAt_idx" RENAME TO "TripTracking_legacy_tripId_recordedAt_idx";

CREATE TABLE "TripTracking" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripTracking_pkey" PRIMARY KEY ("id", "recordedAt")
) PARTITION BY RANGE ("recordedAt");

-- قسم افتراضي يلتقط الصفوف القديمة وأي تاريخ بلا قسم — شبكة أمان لمنع فشل الإدراج.
CREATE TABLE "TripTracking_default" PARTITION OF "TripTracking" DEFAULT;

-- أقسام الشهر السابق والحالي والشهرين القادمين.
SELECT flamingo_ensure_tracking_partition((CURRENT_DATE - INTERVAL '1 month')::DATE);
SELECT flamingo_ensure_tracking_partition(CURRENT_DATE);
SELECT flamingo_ensure_tracking_partition((CURRENT_DATE + INTERVAL '1 month')::DATE);
SELECT flamingo_ensure_tracking_partition((CURRENT_DATE + INTERVAL '2 month')::DATE);

INSERT INTO "TripTracking" ("id", "tripId", "lat", "lng", "heading", "speed", "recordedAt")
SELECT "id", "tripId", "lat", "lng", "heading", "speed", "recordedAt" FROM "TripTracking_legacy";

DROP TABLE "TripTracking_legacy";

-- 3) الفهارس والمفتاح الأجنبي على الجدول الأب (ترثها كل الأقسام تلقائيًا).
CREATE INDEX "TripTracking_tripId_recordedAt_idx" ON "TripTracking"("tripId", "recordedAt");
CREATE INDEX "TripTracking_recordedAt_idx" ON "TripTracking"("recordedAt");

ALTER TABLE "TripTracking"
  ADD CONSTRAINT "TripTracking_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
