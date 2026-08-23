-- Bind refresh tokens to concrete sessions so session revocation from the
-- security center actually invalidates the corresponding login flow.
ALTER TABLE "RefreshToken"
ADD COLUMN "sessionId" TEXT;

CREATE INDEX "RefreshToken_sessionId_idx"
ON "RefreshToken"("sessionId");

CREATE INDEX "RefreshToken_userId_sessionId_revoked_idx"
ON "RefreshToken"("userId", "sessionId", "revoked");
