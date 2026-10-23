-- CreateTable
CREATE TABLE "ProviderCacheEntry" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderCacheEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderCacheEntry_connectionId_repository_idx" ON "ProviderCacheEntry"("connectionId", "repository");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCacheEntry_connectionId_resource_key" ON "ProviderCacheEntry"("connectionId", "resource");

-- AddForeignKey
ALTER TABLE "ProviderCacheEntry" ADD CONSTRAINT "ProviderCacheEntry_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

