ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = 'admin' WHERE "phone" = '0000000000' AND "type" = 'STAFF' AND "username" IS NULL;
UPDATE "User" SET "username" = 'staff_' || regexp_replace("phone", '[^0-9A-Za-z]', '', 'g') WHERE "type" = 'STAFF' AND "username" IS NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
