import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getPrisma } from "@/lib/db";
import { listConnections } from "@/modules/integrations/repository";
import packageJson from "../../../package.json";
import {
  checkAuthSecret,
  checkBackups,
  checkConnections,
  checkDatabase,
  checkEncryptionKey,
  checkMigrations,
  checkVersion,
  type AppliedMigration,
  type CheckStatus,
  type DiagnosticCheck,
} from "./checks";

/**
 * Runs every diagnostic for the signed-in owner's workspace, server-side (SO-03).
 *
 * The probes read the system; `checks.ts` decides what it means. Each probe that can
 * fail returns null rather than throwing, so one broken part never hides the others,
 * and no raw error message (which could quote a connection string) reaches the page.
 */

export type DiagnosticsReport = {
  /** Worst status of all checks. */
  status: CheckStatus;
  checks: DiagnosticCheck[];
  /** ISO instant of the run. */
  generatedAt: string;
};

export type DiagnosticsProbes = {
  pingDatabase: () => Promise<boolean>;
  appliedMigrations: () => Promise<AppliedMigration[] | null>;
  expectedMigrations: () => Promise<string[] | null>;
  backupFiles: () => Promise<string[] | null>;
  connections: (workspaceId: string) => Promise<Parameters<typeof checkConnections>[0]>;
  env: () => { encryptionKey?: string; authSecret?: string; build?: string };
};

const PING_TIMEOUT_MS = 3000;

async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

export const systemProbes: DiagnosticsProbes = {
  pingDatabase: async () => {
    const ping = getPrisma().$queryRaw`SELECT 1`.then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PING_TIMEOUT_MS));
    return (await orNull(() => Promise.race([ping, timeout]))) ?? false;
  },
  appliedMigrations: () =>
    orNull(async () => {
      const rows = await getPrisma().$queryRaw<
        { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
      >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
      return rows.map((row) => ({
        name: row.migration_name,
        finished: row.finished_at !== null,
        rolledBack: row.rolled_back_at !== null,
      }));
    }),
  // The folder ships in the image (see the Dockerfile); absent, the check says so.
  expectedMigrations: () =>
    orNull(async () =>
      (await readdir(join(/* turbopackIgnore: true */ process.cwd(), "prisma", "migrations"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
        .map((entry) => entry.name)
        .sort(),
    ),
  // Names only: the dumps are never opened.
  backupFiles: () =>
    orNull(() =>
      readdir(process.env.BACKUP_DIR || join(/* turbopackIgnore: true */ process.cwd(), "infra", "backups")),
    ),
  connections: (workspaceId) => orNull(() => listConnections(workspaceId)),
  env: () => ({
    encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
    authSecret: process.env.AUTH_SECRET,
    build: process.env.APP_VERSION,
  }),
};

const SEVERITY: Record<CheckStatus, number> = { ok: 0, warning: 1, error: 2 };

export async function runDiagnostics(
  workspaceId: string,
  probes: DiagnosticsProbes = systemProbes,
  now: Date = new Date(),
): Promise<DiagnosticsReport> {
  const env = probes.env();
  const [reachable, applied, expected, backups, connections] = await Promise.all([
    probes.pingDatabase(),
    probes.appliedMigrations(),
    probes.expectedMigrations(),
    probes.backupFiles(),
    probes.connections(workspaceId),
  ]);

  const checks = [
    checkDatabase(reachable),
    checkMigrations(applied, expected),
    checkEncryptionKey(env.encryptionKey),
    checkAuthSecret(env.authSecret),
    checkConnections(connections, now),
    checkBackups(backups, now),
    checkVersion(packageJson.version, env.build),
  ];

  const status = checks.reduce<CheckStatus>(
    (worst, entry) => (SEVERITY[entry.status] > SEVERITY[worst] ? entry.status : worst),
    "ok",
  );

  return { status, checks, generatedAt: now.toISOString() };
}
