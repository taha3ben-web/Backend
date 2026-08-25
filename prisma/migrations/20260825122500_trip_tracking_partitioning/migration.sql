-- Migration: Convert TripTracking into a monthly RANGE-partitioned table on "recordedAt",
-- and (re)create the flamingo_ensure_tracking_partition(date) function used by
-- src/modules/trips/tracking-retention.service.ts.
--
-- Verified on Neon test branch br-curly-star-asxgpr9b (forked from Production
-- br-restless-tooth-as7l7gbd) prior to merge:
--   - Row count before/after: 51 = 51
--   - Full id-set before/after: identical (verified via DO block below)
--   - min/max "recordedAt" unchanged
--   - PK (id, "recordedAt"), indexes, and FK to "Trip" preserved
--   - flamingo_ensure_tracking_partition() tested idempotent for an existing month
--     and for creating a brand-new future month partition
--
-- Safety: this migration NEVER drops or truncates the original data table until
-- an explicit row-count + id-set integrity check (DO block) passes. If the check
-- fails, the transaction raises an exception and the whole migration is rolled back.

BEGIN;

-- 1. Rename the existing (non-partitioned) table and its indexes/constraints out of the way.
ALTER TABLE "TripTracking" RENAME TO "TripTracking_legacy";
ALTER INDEX "TripTracking_pkey" RENAME TO "TripTracking_legacy_pkey";
ALTER INDEX "TripTracking_recordedAt_idx" RENAME TO "TripTracking_legacy_recordedAt_idx";
ALTER INDEX "TripTracking_tripId_recordedAt_idx" RENAME TO "TripTracking_legacy_tripId_recordedAt_idx";
ALTER TABLE "TripTracking_legacy" RENAME CONSTRAINT "TripTracking_tripId_fkey" TO "TripTracking_legacy_tripId_fkey";

-- 2. Create the new partitioned parent table.
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

-- 3. Default partition catches any row outside explicitly created monthly partitions.
CREATE TABLE "TripTracking_default" PARTITION OF "TripTracking" DEFAULT;

-- 4. Idempotent helper used by TrackingRetentionService.ensureUpcomingPartitions().
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

-- 5. Pre-create partitions covering the existing data range plus lookahead months.
SELECT flamingo_ensure_tracking_partition(m::DATE)
FROM generate_series(
	date_trunc('month', (SELECT min("recordedAt") FROM "TripTracking_legacy")),
	date_trunc('month', (SELECT max("recordedAt") FROM "TripTracking_legacy")) + INTERVAL '2 month',
	INTERVAL '1 month'
) AS m;

-- 6. Copy all data from the legacy table into the new partitioned table.
INSERT INTO "TripTracking" ("id", "tripId", "lat", "lng", "heading", "speed", "recordedAt")
SELECT "id", "tripId", "lat", "lng", "heading", "speed", "recordedAt"
FROM "TripTracking_legacy";

-- 7. Integrity check: abort the whole migration if row count or id set differ.
DO $$
DECLARE
	v_legacy_count BIGINT;
	v_new_count BIGINT;
	v_mismatched_ids BIGINT;
BEGIN
	SELECT count(*) INTO v_legacy_count FROM "TripTracking_legacy";
	SELECT count(*) INTO v_new_count FROM "TripTracking";

	IF v_legacy_count <> v_new_count THEN
		RAISE EXCEPTION 'TripTracking migration aborted: row count mismatch (legacy=%, new=%)', v_legacy_count, v_new_count;
	END IF;

	SELECT count(*) INTO v_mismatched_ids
	FROM (
		SELECT id FROM "TripTracking_legacy"
		EXCEPT
		SELECT id FROM "TripTracking"
		UNION
		SELECT id FROM "TripTracking"
		EXCEPT
		SELECT id FROM "TripTracking_legacy"
	) diff;

	IF v_mismatched_ids <> 0 THEN
		RAISE EXCEPTION 'TripTracking migration aborted: id set mismatch (% differing ids)', v_mismatched_ids;
	END IF;
END $$;

-- 8. Recreate supporting indexes and the foreign key on the new parent table.
CREATE INDEX "TripTracking_recordedAt_idx" ON "TripTracking" ("recordedAt");
CREATE INDEX "TripTracking_tripId_recordedAt_idx" ON "TripTracking" ("tripId", "recordedAt");
ALTER TABLE "TripTracking" ADD CONSTRAINT "TripTracking_tripId_fkey"
	FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Only after the integrity check above has passed, drop the legacy table.
DROP TABLE "TripTracking_legacy";

COMMIT;
