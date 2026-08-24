CREATE TABLE "ManagedAsset" ("id" TEXT NOT NULL,"key" TEXT NOT NULL,"kind" TEXT NOT NULL,"audience" TEXT NOT NULL DEFAULT 'PASSENGER',"objectPath" TEXT NOT NULL,"contentType" TEXT NOT NULL,"etag" TEXT NOT NULL,"version" INTEGER NOT NULL DEFAULT 1,"bytes" INTEGER NOT NULL,"width" INTEGER,"height" INTEGER,"isActive" BOOLEAN NOT NULL DEFAULT true,"createdById" TEXT,"updatedById" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "ManagedAsset_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ManagedAsset_key_key" ON "ManagedAsset"("key");
CREATE INDEX "ManagedAsset_audience_isActive_idx" ON "ManagedAsset"("audience","isActive");
CREATE INDEX "ManagedAsset_kind_isActive_idx" ON "ManagedAsset"("kind","isActive");
