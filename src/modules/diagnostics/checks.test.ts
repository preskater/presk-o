import { describe, expect, it } from "vitest";
import {
  backupInstant,
  checkAuthSecret,
  checkBackups,
  checkConnections,
  checkDatabase,
  checkEncryptionKey,
  checkMigrations,
  checkVersion,
} from "./checks";

const NOW = new Date("2026-10-23T12:00:00.000Z");
// Fictitious values only.
const VALID_KEY = Buffer.alloc(32, 9).toString("base64");

describe("checkDatabase", () => {
  it("is ok when the ping answers, an error with an action otherwise", () => {
    expect(checkDatabase(true).status).toBe("ok");
    const down = checkDatabase(false);
    expect(down.status).toBe("error");
    expect(down.action).toMatch(/docker compose up/);
  });
});

describe("checkMigrations", () => {
  const applied = (name: string) => ({ name, finished: true, rolledBack: false });

  it("is ok when every expected migration is applied", () => {
    expect(checkMigrations([applied("a"), applied("b")], ["a", "b"]).status).toBe("ok");
  });

  it("names the pending migrations", () => {
    const result = checkMigrations([applied("a")], ["a", "b", "c"]);
    expect(result.status).toBe("error");
    expect(result.message).toContain("2 migrations en attente : b, c");
    expect(result.action).toMatch(/db:deploy/);
  });

  it("names a failed migration, but not one rolled back", () => {
    const failed = checkMigrations([applied("a"), { name: "b", finished: false, rolledBack: false }], ["a", "b"]);
    expect(failed.status).toBe("error");
    expect(failed.message).toContain("en échec : b");

    const rolledBack = checkMigrations(
      [applied("a"), { name: "b", finished: false, rolledBack: true }, applied("b")],
      ["a", "b"],
    );
    expect(rolledBack.status).toBe("ok");
  });

  it("says what it cannot see instead of claiming all is well", () => {
    const blind = checkMigrations([applied("a")], null);
    expect(blind.status).toBe("warning");
    expect(blind.message).toContain("pas détectables");
    expect(checkMigrations(null, ["a"]).status).toBe("error");
  });
});

describe("checkEncryptionKey", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(checkEncryptionKey(VALID_KEY).status).toBe("ok");
  });

  it("reports a missing or malformed key without echoing it", () => {
    expect(checkEncryptionKey(undefined).status).toBe("error");
    const short = Buffer.alloc(16, 9).toString("base64");
    const result = checkEncryptionKey(short);
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain(short);
  });
});

describe("checkAuthSecret", () => {
  it("applies the same 32-character rule as getServerEnv", () => {
    expect(checkAuthSecret("x".repeat(32)).status).toBe("ok");
    expect(checkAuthSecret("x".repeat(31)).status).toBe("error");
    expect(checkAuthSecret(undefined).status).toBe("error");
  });
});

describe("checkConnections", () => {
  const base = { provider: "GITLAB" as const, instanceUrl: "https://gitlab.example.test", lastSyncError: null };

  it("is ok with no connection, or with recent synchronisations", () => {
    expect(checkConnections([], NOW).status).toBe("ok");
    expect(
      checkConnections([{ ...base, status: "CONNECTED", lastSyncedAt: new Date("2026-10-22T08:00:00Z") }], NOW).status,
    ).toBe("ok");
  });

  it("warns on a stale, never synchronised or disconnected provider", () => {
    const stale = checkConnections([{ ...base, status: "CONNECTED", lastSyncedAt: new Date("2026-10-01T00:00:00Z") }], NOW);
    expect(stale.status).toBe("warning");
    expect(stale.message).toContain("il y a 22 jours");
    expect(checkConnections([{ ...base, status: "CONNECTED", lastSyncedAt: null }], NOW).status).toBe("warning");
    expect(checkConnections([{ ...base, status: "NOT_CONNECTED", lastSyncedAt: null }], NOW).status).toBe("warning");
  });

  it("reports a failed synchronisation by its safe code and host only", () => {
    const result = checkConnections(
      [{ ...base, instanceUrl: "https://gitlab.example.test/some/path", status: "ERROR", lastSyncedAt: null, lastSyncError: "HTTP_401" }],
      NOW,
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("GitLab (gitlab.example.test)");
    expect(result.message).toContain("HTTP_401");
    expect(result.message).not.toContain("/some/path");
  });
});

describe("checkBackups", () => {
  it("reads the instant from the backup.sh file name only", () => {
    expect(backupInstant("dashboard-20261020T030000Z.dump")?.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(backupInstant("notes.txt")).toBeNull();
    expect(backupInstant("dashboard-20261340T030000Z.dump")).toBeNull();
  });

  it("is ok for a recent backup, and picks the newest", () => {
    const result = checkBackups(["dashboard-20260101T000000Z.dump", "dashboard-20261021T030000Z.dump", "README.md"], NOW);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("il y a 2 jours");
  });

  it("warns past the age limit, errors with none, warns when not visible", () => {
    expect(checkBackups(["dashboard-20261001T000000Z.dump"], NOW).status).toBe("warning");
    expect(checkBackups(["README.md"], NOW).status).toBe("error");
    expect(checkBackups(null, NOW).status).toBe("warning");
  });
});

describe("checkVersion", () => {
  it("shows a safe build identifier and ignores anything else", () => {
    expect(checkVersion("0.1.0", "abc1234").message).toBe("0.1.0 (build abc1234)");
    expect(checkVersion("0.1.0", "<script>").message).toContain("non renseignée");
    expect(checkVersion("0.1.0", undefined).message).toContain("non renseignée");
  });
});
