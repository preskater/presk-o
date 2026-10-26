-- AlterTable
ALTER TABLE "ProjectSnapshot" ADD COLUMN     "ciCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "ciError" TEXT;

-- CreateTable
CREATE TABLE "CiRunSnapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "workflowName" TEXT NOT NULL,
    "branch" TEXT,
    "status" TEXT NOT NULL,
    "conclusion" TEXT,
    "url" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "runUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CiRunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CiRunSnapshot_connectionId_repository_idx" ON "CiRunSnapshot"("connectionId", "repository");

-- CreateIndex
CREATE UNIQUE INDEX "CiRunSnapshot_connectionId_externalId_key" ON "CiRunSnapshot"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "CiRunSnapshot" ADD CONSTRAINT "CiRunSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
