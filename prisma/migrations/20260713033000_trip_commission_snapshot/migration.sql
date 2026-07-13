-- Persist the pricing commission used when the trip was requested.
-- This keeps settlement deterministic even if pricing rules change later.
ALTER TABLE "Trip"
ADD COLUMN "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 15;

-- New vehicle pricing rules should inherit NOVA's standard commission unless
-- an explicit percentage is supplied by the control center.
ALTER TABLE "VehiclePricingRule"
ALTER COLUMN "commissionPct" SET DEFAULT 15;
