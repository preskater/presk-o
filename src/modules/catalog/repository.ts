import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { activeModules, validateModuleChange, type ModuleChange } from "./catalog";

/**
 * Applies an enable/disable request to one workspace, after `validateModuleChange`.
 *
 * Only the `WorkspaceModule` row is written: enabling never creates records in the
 * module itself, and disabling keeps both its records and its configuration, so
 * re-enabling finds everything where it was. The caller has already resolved
 * `workspaceId` from the session's memberships; it is never taken from the browser.
 */
export async function applyModuleChange(
  workspaceId: string,
  input: { key: unknown; enabled: boolean; config?: unknown },
): Promise<ModuleChange> {
  const prisma = getPrisma();
  const rows = await prisma.workspaceModule.findMany({
    where: { workspaceId },
    select: { moduleKey: true, enabled: true },
  });

  const change = validateModuleChange(input, activeModules(rows));
  if (change.status !== "ok") {
    return change;
  }

  const config = change.config as Prisma.InputJsonObject | undefined;
  await prisma.workspaceModule.upsert({
    where: { workspaceId_moduleKey: { workspaceId, moduleKey: change.key } },
    create: { workspaceId, moduleKey: change.key, enabled: change.enabled, config },
    update: { enabled: change.enabled, config },
  });

  return change;
}
