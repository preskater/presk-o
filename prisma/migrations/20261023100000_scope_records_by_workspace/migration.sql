-- M7-04: every budget, real-estate, integration and alert record belongs to a workspace.
--
-- Sequence (learned from `IssueSnapshot.assignees`): nullable column, deterministic
-- backfill, then NOT NULL. No row is inserted, deleted or rewritten beyond the new
-- column, so row counts and sums are identical before and after.
--
-- Child tables (PropertyLoan, PropertyCashflow, ProjectSnapshot, IssueSnapshot,
-- MilestoneSnapshot, ProviderCacheEntry, SyncRun) carry no `workspaceId`: they are only
-- reachable through their parent property or connection, which carries it, and a
-- denormalised copy could drift from its parent.
--
-- `userId` stays, nullable, so a rollback finds every original value (see
-- docs/architecture/workspace-scoping.md). Dropping it is a later, separate migration.

-- 1. Every owner already has a personal workspace since M7-01; repeat that idempotent
-- backfill so a user created in between cannot make step 3 fail on a missing workspace.
INSERT INTO "Workspace" ("id", "name", "kind", "createdAt", "updatedAt")
SELECT 'ws-' || "id", 'Personnel', 'PERSONAL', NOW(), NOW()
FROM "User"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm-' || "id", 'ws-' || "id", "id", 'OWNER', NOW()
FROM "User"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

-- 2-4. Nullable column, backfill to the owner's default workspace (same identifier as
-- `defaultWorkspaceId`), then NOT NULL. One statement per table: the data of a
-- personal dashboard is small. ponytail: no batching; batch per id range if a table
-- ever holds millions of rows.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Account', 'Category', 'Transaction', 'Budget', 'SalarySetting', 'SalaryRate',
    'WorkDay', 'RecurringEntry', 'RecurringOccurrence', 'Goal', 'GoalContribution',
    'Property', 'IntegrationConnection', 'Alert', 'AlertRule'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "workspaceId" TEXT', t);
    EXECUTE format('UPDATE %I SET "workspaceId" = ''ws-'' || "userId"', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "workspaceId" SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "userId" DROP NOT NULL', t);
  END LOOP;
END $$;

-- 5. Unique constraints and indexes move from the owner to the workspace dimension.
DROP INDEX "Account_userId_idx";
DROP INDEX "Account_userId_name_key";
DROP INDEX "Category_userId_idx";
DROP INDEX "Category_userId_name_kind_key";
DROP INDEX "Transaction_userId_operationDate_idx";
DROP INDEX "Transaction_userId_categoryId_idx";
DROP INDEX "Budget_userId_year_month_idx";
DROP INDEX "Budget_userId_categoryId_year_month_currency_key";
DROP INDEX "SalaryRate_userId_year_month_key";
DROP INDEX "WorkDay_userId_date_key";
DROP INDEX "RecurringEntry_userId_idx";
DROP INDEX "RecurringOccurrence_userId_status_date_idx";
DROP INDEX "Goal_userId_idx";
DROP INDEX "GoalContribution_userId_goalId_date_idx";
DROP INDEX "Property_userId_idx";
DROP INDEX "Property_userId_name_key";
DROP INDEX "IntegrationConnection_userId_idx";
DROP INDEX "IntegrationConnection_userId_provider_instanceUrl_key";
DROP INDEX "Alert_userId_status_idx";
DROP INDEX "Alert_userId_fingerprint_key";
DROP INDEX "AlertRule_userId_kind_key";

CREATE INDEX "Account_workspaceId_idx" ON "Account"("workspaceId");
CREATE UNIQUE INDEX "Account_workspaceId_name_key" ON "Account"("workspaceId", "name");
CREATE INDEX "Category_workspaceId_idx" ON "Category"("workspaceId");
CREATE UNIQUE INDEX "Category_workspaceId_name_kind_key" ON "Category"("workspaceId", "name", "kind");
CREATE INDEX "Transaction_workspaceId_operationDate_idx" ON "Transaction"("workspaceId", "operationDate");
CREATE INDEX "Transaction_workspaceId_categoryId_idx" ON "Transaction"("workspaceId", "categoryId");
CREATE INDEX "Budget_workspaceId_year_month_idx" ON "Budget"("workspaceId", "year", "month");
CREATE UNIQUE INDEX "Budget_workspaceId_categoryId_year_month_currency_key" ON "Budget"("workspaceId", "categoryId", "year", "month", "currency");
CREATE UNIQUE INDEX "SalarySetting_workspaceId_key" ON "SalarySetting"("workspaceId");
CREATE UNIQUE INDEX "SalaryRate_workspaceId_year_month_key" ON "SalaryRate"("workspaceId", "year", "month");
CREATE UNIQUE INDEX "WorkDay_workspaceId_date_key" ON "WorkDay"("workspaceId", "date");
CREATE INDEX "RecurringEntry_workspaceId_idx" ON "RecurringEntry"("workspaceId");
CREATE INDEX "RecurringOccurrence_workspaceId_status_date_idx" ON "RecurringOccurrence"("workspaceId", "status", "date");
CREATE INDEX "Goal_workspaceId_idx" ON "Goal"("workspaceId");
CREATE INDEX "GoalContribution_workspaceId_goalId_date_idx" ON "GoalContribution"("workspaceId", "goalId", "date");
CREATE INDEX "Property_workspaceId_idx" ON "Property"("workspaceId");
CREATE UNIQUE INDEX "Property_workspaceId_name_key" ON "Property"("workspaceId", "name");
CREATE INDEX "IntegrationConnection_workspaceId_idx" ON "IntegrationConnection"("workspaceId");
CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_provider_instanceUrl_key" ON "IntegrationConnection"("workspaceId", "provider", "instanceUrl");
CREATE INDEX "Alert_workspaceId_status_idx" ON "Alert"("workspaceId", "status");
CREATE UNIQUE INDEX "Alert_workspaceId_fingerprint_key" ON "Alert"("workspaceId", "fingerprint");
CREATE UNIQUE INDEX "AlertRule_workspaceId_kind_key" ON "AlertRule"("workspaceId", "kind");

-- 6. A deleted workspace takes its records with it, like a deleted owner did.
ALTER TABLE "Account" ADD CONSTRAINT "Account_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalarySetting" ADD CONSTRAINT "SalarySetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryRate" ADD CONSTRAINT "SalaryRate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringEntry" ADD CONSTRAINT "RecurringEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Property" ADD CONSTRAINT "Property_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
