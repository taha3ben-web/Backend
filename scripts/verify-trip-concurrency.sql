-- تحقق من قاعدة تزامن رحلات الراكب على PostgreSQL حقيقي.
-- التشغيل على قاعدة تطوير/تجريب فقط؛ كل شيء ينتهي بـ ROLLBACK.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'Trip'
           AND indexname = 'Trip_one_active_per_passenger_idx'
    ) THEN
        RAISE EXCEPTION 'Trip_one_active_per_passenger_idx is missing — migration 20260910060000_trip_active_passenger_uniqueness was not applied';
    END IF;
    RAISE NOTICE 'OK  index Trip_one_active_per_passenger_idx exists';
END
$$;

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
        0, 'DZD', 'CASH', now(), now()
    );
    RETURN new_id;
END
$$;

DO $$
DECLARE t TEXT;
BEGIN
    t := verify_new_trip('11111111-1111-1111-1111-111111111111', 'SEARCHING');
    RAISE NOTICE 'OK  first immediate ride created (%)', t;
END
$$;

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
    PERFORM verify_new_trip('11111111-1111-1111-1111-111111111111', 'SCHEDULED');
    RAISE NOTICE 'OK  a second future booking is still allowed';
END
$$;

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

DO $$
BEGIN
    PERFORM verify_new_trip('22222222-2222-2222-2222-222222222222', 'SEARCHING');
    RAISE NOTICE 'OK  a different passenger is unaffected';
END
$$;

DROP FUNCTION verify_new_trip(TEXT, "TripStatus");
ROLLBACK;
