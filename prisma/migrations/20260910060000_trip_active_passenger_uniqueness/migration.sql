-- Migration: enforce "at most one ACTIVE Trip per passenger" at the database level.
--
-- Rationale
-- ---------
-- MatchingService.requestRide() and FareOffersService.acceptOffer() both perform an
-- application-level active-trip pre-check (trip.findFirst -> ACTIVE_TRIP_EXISTS) and
-- later create a Trip. Those are two separate statements, so two concurrent requests
-- (possibly on different processes and different database connections) can both pass
-- the pre-check and both insert an active Trip. The pre-check remains valuable for a
-- fast, user-friendly error, but it is NOT a concurrency guarantee. This partial
-- unique index is the authoritative boundary.
--
-- Scope of the invariant
-- ----------------------
-- Active  (participates in the index): SEARCHING, ACCEPTED, ARRIVING, IN_PROGRESS
-- Excluded (do NOT participate)      : SCHEDULED, COMPLETED, CANCELLED
--
-- Because SCHEDULED is excluded, a passenger may still hold a SCHEDULED trip while a
-- separate trip is active, and the existing scheduled-activation CAS
-- (WHERE id = ? AND status = 'SCHEDULED' SET status = 'SEARCHING') is unchanged: that
-- UPDATE simply becomes subject to the index at the moment the row turns SEARCHING.
-- Because COMPLETED and CANCELLED are excluded, completing or cancelling a trip frees
-- the slot automatically; no lifecycle/transition definition is modified.
--
-- This migration does NOT mutate any Trip row. If the database already violates the
-- invariant, the migration aborts and the operator must resolve the duplicates
-- deliberately. Silently repairing production data here would hide a real integrity
-- violation.

BEGIN;

-- 1. Preflight: abort BEFORE creating the index if duplicate active trips already exist.
DO $$
DECLARE
	v_offending_passengers BIGINT;
	v_sample TEXT;
BEGIN
	SELECT count(*), min("passengerId")
	INTO v_offending_passengers, v_sample
	FROM (
		SELECT "passengerId"
		FROM "Trip"
		WHERE "status" IN ('SEARCHING', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS')
		GROUP BY "passengerId"
		HAVING count(*) > 1
	) dup;

	IF v_offending_passengers > 0 THEN
		RAISE EXCEPTION
			'Trip active-passenger uniqueness migration aborted: % passenger(s) already have more than one active Trip (SEARCHING/ACCEPTED/ARRIVING/IN_PROGRESS). Example passengerId: %. Resolve these duplicates manually before applying this migration; this migration intentionally does not mutate Trip rows.',
			v_offending_passengers, v_sample;
	END IF;
END $$;

-- 2. The authoritative invariant. Partial unique indexes cannot be expressed in the
--    Prisma schema language, so this is raw SQL and "Trip" carries no @@unique for it.
--    passengerId is NOT globally unique; only active rows are constrained.
CREATE UNIQUE INDEX "Trip_one_active_per_passenger_idx"
	ON "Trip" ("passengerId")
	WHERE "status" IN ('SEARCHING', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS');

COMMIT;
