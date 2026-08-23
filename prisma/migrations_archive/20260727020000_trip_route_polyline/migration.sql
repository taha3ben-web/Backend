-- مسار الرحلة الحقيقي من محرك التوجيه.
ALTER TABLE "Trip" ADD COLUMN "routePolyline" TEXT;
ALTER TABLE "Trip" ADD COLUMN "routeProvider" VARCHAR(20);
