-- ============================================================================
-- تحقّق من قاعدة تزامن رحلات الراكب **على قاعدة بيانات حقيقية**.
--
-- يُثبت أن السلطة النهائية هي PostgreSQL لا طبقة التطبيق:
--   1. رحلة فورية واحدة تنجح.
--   2. رحلة فورية ثانية لنفس الراكب تفشل (23505) في كل حالة جارية.
--   3. حجز SCHEDULED + رحلة فورية = مسموح.
--   4. بعد الإلغاء/الإكمال = رحلة فورية جديدة مسموحة.
--   5. القاعدة لكل راكب لا عامة.
--
-- التشغيل (على قاعدة تطوير/تجريب فقط — ينشئ صفوفًا ثم يتراجع عنها):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-trip-concurrency.sql
--
-- كل شيء داخل معاملة واحدة تنتهي بـROLLBACK: لا يبقى أي صف بعد التنفيذ.
-- ============================================================================

BEGIN;

-- الفهرس موجود أصلًا؟ (يفشل السكربت فورًا إن لم يكن — أي المايغريشن لم يُطبَّق)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE indexname = 'Trip_active_passenger_unique'
    ) THEN
        RAISE EXCEPTION 'Trip_active_passenger_unique is missing — migration 20260912090100 was not applied';
    END IF;
    RAISE NOTICE 'OK  index Trip_active_passenger_unique exists';
END
$$;

-- بيانات اختبار معزولة.
INSERT INTO "User" (id, name, phone, "passwordHash", type, status, "updatedAt")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Verify P1', '+213000000001', 'x', 'PASSENGER', 'ACTIVE', now()),
  ('22222222-2222-2222-2222-222222222222', 'Verify P2', '+213000000002', 'x', 'PASSENGER', 'ACTIVE', now());

CREATE OR REPLACE FUNCTION verify_new_trip(p_passenger TEXT, p_status "TripStatus")
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    new_id TEXT := gen_random_uuid()::text;
BEGIN
    INSERT INTO "Trip" (
        id, "passengerId", status, "rideClass", "pickupLat", "pickupLng",
        "commissionPct", currency, "paymentMethod", "createdAt", "updatedAt"
    ) VALUES (
        new_id, p_passenger, p_status, 'ECONOMY', 36.75, 3.06,
        -- نسبة اختبارية للصف فقط؛ لا علاقة لها بأي إعداد عمولة.
        0, 'DZD', 'CASH', now(), now()
    );
    RETURN new_id;
END
$$;

-- 1) رحلة فورية أولى تنجح.
DO $$
DECLARE t TEXT;
BEGIN
    t := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    RAISE NOTICE 'OK  first immediate ride created (%)', t;
END
$$;

-- 2) رحلة فورية ثانية تفشل في كل حالة جارية.
DO $$
DECLARE
    st "TripStatus";
    current_trip TEXT;
BEGIN
    SELECT id INTO current_trip FROM "Trip"
     WHERE "passengerId" = '11111111-1111-1111-1111-111111111111';

    FOREACH st IN ARRAY ARRAY['SEARCHING','ACCEPTED','ARRIVING','IN_PROGRESS']::"TripStatus"[]
    LOOP
        UPDATE "Trip" SET status = st WHERE id = current_trip;
        BEGIN
            PERFORM verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
            RAISE EXCEPTION 'FAIL a second immediate ride was allowed while current status = %', st;
        EXCEPTION WHEN unique_violation THEN
            RAISE NOTICE 'OK  second immediate ride rejected while current status = % (SQLSTATE 23505)', st;
        END;
    END LOOP;
END
$$;

-- 3) SCHEDULED لا يحجب رحلة فورية.
DO $$
DECLARE
    booking TEXT;
    immediate TEXT;
BEGIN
    DELETE FROM "Trip" WHERE "passengerId" = '11111111-1111-1111-1111-111111111111';
    booking := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SCHEDULED');
    UPDATE "Trip" SET "isScheduled" = true, "scheduledAt" = now() + interval '7 days'
     WHERE id = booking;
    immediate := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    RAISE NOTICE 'OK  scheduled booking (%) coexists with immediate ride (%)', booking, immediate;

    -- والحجز الثاني مسموح أيضًا: الفهرس لا يمسّ SCHEDULED إطلاقًا.
    PERFORM verify_new_trip('11111111-1111-1111-1111-111111111111', 'SCHEDULED');
    RAISE NOTICE 'OK  a second future booking is still allowed';
END
$$;

-- 4) بعد الإلغاء ثم بعد الإكمال: رحلة فورية جديدة مسموحة.
DO $$
DECLARE t TEXT;
BEGIN
    DELETE FROM "Trip" WHERE "passengerId" = '11111111-1111-1111-1111-111111111111';
    t := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    UPDATE "Trip" SET status = 'CANCELLED' WHERE id = t;
    t := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    RAISE NOTICE 'OK  new immediate ride allowed after cancellation';
    UPDATE "Trip" SET status = 'IN_PROGRESS' WHERE id = t;
    UPDATE "Trip" SET status = 'COMPLETED' WHERE id = t;
    PERFORM verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    RAISE NOTICE 'OK  new immediate ride allowed after completion';
END
$$;

-- 5) القاعدة لكل راكب.
DO $$
BEGIN
    PERFORM verify_new_trip('22222222-2222-2222-2222-222222222222', 'SEARCHING');
    RAISE NOTICE 'OK  a different passenger is unaffected';
END
$$;

DROP FUNCTION verify_new_trip(TEXT, "TripStatus");

ROLLBACK;
