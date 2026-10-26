-- CreateTable
CREATE TABLE "WorkspaceModule" (
    "workspaceId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkspaceModule_pkey" PRIMARY KEY ("workspaceId","moduleKey")
);

-- AddForeignKey
ALTER TABLE "WorkspaceModule" ADD CONSTRAINT "WorkspaceModule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing workspace keeps the modules it could already use, so the
-- deployment hides nothing. Same list as `DEFAULT_MODULES` (src/modules/catalog);
-- re-running never duplicates a row.
INSERT INTO "WorkspaceModule" ("workspaceId", "moduleKey", "enabled", "config", "createdAt", "updatedAt")
SELECT w."id", m."key", true, '{}', NOW(), NOW()
FROM "Workspace" w
CROSS JOIN (VALUES ('budget'), ('real-estate'), ('development')) AS m("key")
ON CONFLICT ("workspaceId", "moduleKey") DO NOTHING;
