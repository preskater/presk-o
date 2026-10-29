import { describe, expect, it, vi } from "vitest";

// The real probes are never used here: no database, no file system.
vi.mock("@/lib/db", () => ({ getPrisma: () => { throw new Error("no database in tests"); } }));

const { runDiagnostics } = await import("./run");
type Probes = import("./run").DiagnosticsProbes;

const NOW = new Date("2026-10-23T12:00:00.000Z");

// Fictitious, recognisable secrets: the redaction test looks for them in the output.
const KEY = Buffer.from("FICTITIOUS-ENCRYPTION-KEY-32-BYT").toString("base64");
const SECRET = "FICTITIOUS-SESSION-SECRET-0123456789-abcdef";
const DATABASE_URL = "postgresql://fictif:mot-de-passe-fictif@db.example.test:5432/dashboard";

function healthy(overrides: Partial<Probes> = {}): Probes {
  return {
    pingDatabase: async () => true,
    appliedMigrations: async () => [{ name: "20260101_init", finished: true, rolledBack: false }],
    expectedMigrations: async () => ["20260101_init"],
    backupFiles: async () => ["dashboard-20261022T030000Z.dump"],
    connections: async () => [
      {
        provider: "GITHUB",
        instanceUrl: "https://github.com",
        status: "CONNECTED",
        lastSyncedAt: new Date("2026-10-23T08:00:00Z"),
        lastSyncError: null,
      },
    ],
    env: () => ({ encryptionKey: KEY, authSecret: SECRET, build: "abc1234" }),
    ...overrides,
  };
}

describe("runDiagnostics", () => {
  it("reports ok when every probe is healthy", async () => {
    const report = await runDiagnostics("owner-fixture", healthy(), NOW);

    expect(report.status).toBe("ok");
    expect(report.checks.map((entry) => entry.id)).toEqual([
      "database",
      "migrations",
      "encryption-key",
      "auth-secret",
      "connections",
      "backups",
      "version",
    ]);
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it("keeps reporting every part when the database is down, worst status first", async () => {
    const report = await runDiagnostics(
      "owner-fixture",
      healthy({ pingDatabase: async () => false, appliedMigrations: async () => null, connections: async () => null }),
      NOW,
    );

    expect(report.status).toBe("error");
    expect(report.checks).toHaveLength(7);
    expect(report.checks.find((entry) => entry.id === "backups")?.status).toBe("ok");
  });

  it("passes the workspace to the connection probe", async () => {
    const connections = vi.fn(async () => []);
    await runDiagnostics("workspace-fixture", healthy({ connections }), NOW);
    expect(connections).toHaveBeenCalledWith("workspace-fixture");
  });

  it("redaction: no secret, nor any part of one, reaches the report", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    const valid = JSON.stringify(await runDiagnostics("owner-fixture", healthy(), NOW));
    const broken = JSON.stringify(
      await runDiagnostics(
        "owner-fixture",
        healthy({ env: () => ({ encryptionKey: KEY.slice(0, 20), authSecret: SECRET.slice(0, 20), build: undefined }) }),
        NOW,
      ),
    );
    vi.unstubAllEnvs();

    for (const output of [valid, broken]) {
      for (const secret of [KEY, SECRET, DATABASE_URL]) {
        // Any 8-character window of a secret would already be a leak.
        for (let start = 0; start + 8 <= secret.length; start += 4) {
          expect(output).not.toContain(secret.slice(start, start + 8));
        }
      }
      expect(output).not.toMatch(/mot-de-passe|postgresql:\/\//);
    }
  });

  it("negative control: the redaction scan does catch a leaked fragment", () => {
    const leaky = JSON.stringify({ message: `clé : ${KEY.slice(4, 16)}` });
    const leaked = [];
    for (let start = 0; start + 8 <= KEY.length; start += 4) {
      if (leaky.includes(KEY.slice(start, start + 8))) leaked.push(start);
    }
    expect(leaked.length).toBeGreaterThan(0);
  });
});
