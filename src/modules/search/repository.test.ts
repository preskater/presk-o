import Decimal from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_KINDS } from "./domain";

/**
 * Owner scoping of the global search, per kind.
 *
 * The fake client filters the fixtures the way PostgreSQL applies the `where` it
 * receives, so a query that forgot its workspace filter would return the foreign rows
 * placed next to the owner's and fail these tests. `take` is applied too, which is what
 * makes the per-kind bound observable.
 */
type Row = Record<string, unknown>;
type FindManyArgs = { where?: unknown; take?: number; orderBy?: unknown };

const OWNER = "ws-owner";
const FOREIGN = "ws-foreign";

const TABLES = [
  "transaction",
  "account",
  "property",
  "projectSnapshot",
  "issueSnapshot",
  "milestoneSnapshot",
  "integrationConnection",
] as const;

type Table = (typeof TABLES)[number];

const fixtures = Object.fromEntries(TABLES.map((table) => [table, [] as Row[]])) as Record<
  Table,
  Row[]
>;
const calls = Object.fromEntries(TABLES.map((table) => [table, [] as FindManyArgs[]])) as Record<
  Table,
  FindManyArgs[]
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The subset of Prisma's `where` semantics these queries use. */
function matches(row: Row, where: unknown): boolean {
  if (!isPlainObject(where)) {
    return true;
  }

  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as unknown[]).some((branch) => matches(row, branch));
    }

    const value = row[key];

    if (isPlainObject(condition) && "contains" in condition) {
      const needle = String(condition.contains);
      const haystack = String(value ?? "");
      return condition.mode === "insensitive"
        ? haystack.toLowerCase().includes(needle.toLowerCase())
        : haystack.includes(needle);
    }

    if (isPlainObject(condition) && isPlainObject(value)) {
      return matches(value, condition);
    }

    return value === condition;
  });
}

const prisma = Object.fromEntries(
  TABLES.map((table) => [
    table,
    {
      findMany: async (args: FindManyArgs) => {
        calls[table].push(args);
        const found = fixtures[table].filter((row) => matches(row, args.where));
        return typeof args.take === "number" ? found.slice(0, args.take) : found;
      },
    },
  ]),
);

vi.mock("@/lib/db", () => ({ getPrisma: () => prisma }));

const { getProviderSearchState, searchAll } = await import("./repository");

const OPERATION_DATE = new Date("2026-10-05T00:00:00Z");

function transaction(overrides: Row = {}): Row {
  return {
    id: "transaction-owner",
    workspaceId: OWNER,
    label: "Test loyer",
    amount: new Decimal(-950),
    currency: "EUR",
    operationDate: OPERATION_DATE,
    account: { name: "Compte courant" },
    ...overrides,
  };
}

function account(overrides: Row = {}): Row {
  return {
    id: "account-owner",
    workspaceId: OWNER,
    archivedAt: null,
    name: "Test courant",
    type: "CHECKING",
    currency: "EUR",
    ...overrides,
  };
}

function property(overrides: Row = {}): Row {
  return {
    id: "property-owner",
    workspaceId: OWNER,
    name: "Test appartement",
    address: "1 rue du Test",
    ...overrides,
  };
}

function project(overrides: Row = {}): Row {
  return {
    id: "project-owner",
    connection: { workspaceId: OWNER },
    name: "owner/test-project",
    externalUrl: "https://github.test/owner/test-project",
    provider: "GITHUB",
    ...overrides,
  };
}

function issue(overrides: Row = {}): Row {
  return {
    id: "issue-owner",
    connection: { workspaceId: OWNER },
    title: "Test issue",
    repository: "owner/test-project",
    number: 42,
    url: "https://github.test/owner/test-project/issues/42",
    kind: "ISSUE",
    provider: "GITHUB",
    ...overrides,
  };
}

function milestone(overrides: Row = {}): Row {
  return {
    id: "milestone-owner",
    connection: { workspaceId: OWNER },
    title: "Test jalon",
    repository: "owner/test-project",
    state: "open",
    dueOn: new Date("2026-11-30T00:00:00Z"),
    url: "https://github.test/owner/test-project/milestone/1",
    ...overrides,
  };
}

function seedOneRowPerKind() {
  fixtures.transaction = [
    transaction(),
    transaction({ id: "transaction-foreign", workspaceId: FOREIGN }),
  ];
  fixtures.account = [account(), account({ id: "account-foreign", workspaceId: FOREIGN })];
  fixtures.property = [property(), property({ id: "property-foreign", workspaceId: FOREIGN })];
  fixtures.projectSnapshot = [
    project(),
    project({ id: "project-foreign", connection: { workspaceId: FOREIGN } }),
  ];
  fixtures.issueSnapshot = [
    issue(),
    issue({ id: "issue-foreign", connection: { workspaceId: FOREIGN } }),
  ];
  fixtures.milestoneSnapshot = [
    milestone(),
    milestone({ id: "milestone-foreign", connection: { workspaceId: FOREIGN } }),
  ];
}

beforeEach(() => {
  for (const table of TABLES) {
    fixtures[table] = [];
    calls[table] = [];
  }
});

describe("searchAll", () => {
  it("never returns a foreign workspace's row, for any kind", async () => {
    seedOneRowPerKind();

    const results = await searchAll({ workspaceId: OWNER, query: "test", kinds: SEARCH_KINDS });
    const ids = Object.fromEntries(
      results.groups.map((group) => [group.kind, group.items.map((item) => item.id)]),
    );

    expect(ids).toEqual({
      transaction: ["transaction-owner"],
      account: ["account-owner"],
      property: ["property-owner"],
      project: ["project-owner"],
      issue: ["issue-owner"],
      milestone: ["milestone-owner"],
    });
    expect(results.total).toBe(6);
  });

  it("scopes every read: workspace column, or the connection for snapshots", async () => {
    seedOneRowPerKind();

    await searchAll({ workspaceId: OWNER, query: "test", kinds: SEARCH_KINDS });

    expect(calls.transaction[0]?.where).toMatchObject({ workspaceId: OWNER });
    expect(calls.account[0]?.where).toMatchObject({ workspaceId: OWNER, archivedAt: null });
    expect(calls.property[0]?.where).toMatchObject({ workspaceId: OWNER });
    for (const table of ["projectSnapshot", "issueSnapshot", "milestoneSnapshot"] as const) {
      expect(calls[table][0]?.where).toMatchObject({ connection: { workspaceId: OWNER } });
    }
  });

  it("bounds each kind and says when more rows exist", async () => {
    fixtures.account = [
      account({ id: "account-1", name: "Test un" }),
      account({ id: "account-2", name: "Test deux" }),
      account({ id: "account-3", name: "Test trois" }),
      account({ id: "account-4", name: "Test quatre" }),
    ];

    const results = await searchAll({
      workspaceId: OWNER,
      query: "test",
      limit: 2,
      kinds: ["account"],
    });

    expect(results.groups).toHaveLength(1);
    expect(results.groups[0].items).toHaveLength(2);
    expect(results.groups[0].truncated).toBe(true);
    // One extra row tells the page that more exists, without a count query.
    expect(calls.account[0]?.take).toBe(3);
  });

  it("does not flag truncation at the boundary", async () => {
    fixtures.account = [account({ id: "account-1" }), account({ id: "account-2" })];

    const [group] = (
      await searchAll({ workspaceId: OWNER, query: "test", limit: 2, kinds: ["account"] })
    ).groups;

    expect(group.items).toHaveLength(2);
    expect(group.truncated).toBe(false);
  });

  it("reads nothing for an empty or too short query", async () => {
    fixtures.account = [account()];

    expect(await searchAll({ workspaceId: OWNER, query: "   ", kinds: SEARCH_KINDS })).toEqual({
      groups: [],
      total: 0,
    });
    expect(await searchAll({ workspaceId: OWNER, query: " a ", kinds: SEARCH_KINDS })).toEqual({
      groups: [],
      total: 0,
    });
    expect(calls.account).toHaveLength(0);
  });

  it("returns no group when nothing matches", async () => {
    fixtures.account = [account()];

    expect(await searchAll({ workspaceId: OWNER, query: "introuvable", kinds: SEARCH_KINDS })).toEqual({
      groups: [],
      total: 0,
    });
  });

  it("queries only the kinds whose module is active", async () => {
    seedOneRowPerKind();

    const results = await searchAll({
      workspaceId: OWNER,
      query: "test",
      kinds: ["property"],
    });

    expect(results.groups.map((group) => group.kind)).toEqual(["property"]);
    expect(calls.transaction).toHaveLength(0);
    expect(calls.projectSnapshot).toHaveLength(0);
  });

  it("links a transaction to its own month and a provider row to its source", async () => {
    seedOneRowPerKind();

    const results = await searchAll({ workspaceId: OWNER, query: "test", kinds: SEARCH_KINDS });
    const transaction_ = results.groups.find((group) => group.kind === "transaction")!.items[0];
    const project_ = results.groups.find((group) => group.kind === "project")!.items[0];

    expect(transaction_.href).toBe(
      "/budget?tab=operations&month=2026-10&q=Test%20loyer",
    );
    expect(transaction_.detail).toContain("Compte courant");
    expect(project_.href).toBe("https://github.test/owner/test-project");
    expect(project_.external).toBe(true);
  });
});

describe("getProviderSearchState", () => {
  it("reads only this workspace's connections", async () => {
    fixtures.integrationConnection = [
      {
        provider: "GITHUB",
        status: "CONNECTED",
        lastSyncedAt: new Date("2026-10-28T10:00:00Z"),
        lastSyncError: null,
        workspaceId: OWNER,
      },
      {
        provider: "GITLAB",
        status: "ERROR",
        lastSyncedAt: null,
        lastSyncError: "UNAUTHORIZED (HTTP 401)",
        workspaceId: FOREIGN,
      },
    ];

    const state = await getProviderSearchState(OWNER, new Date("2026-10-28T12:00:00Z"));

    expect(state).toEqual({
      kind: "ok",
      lastSyncedAt: new Date("2026-10-28T10:00:00Z"),
      stale: false,
    });
    expect(calls.integrationConnection[0]?.where).toEqual({ workspaceId: OWNER });
  });

  it("reports not connected when the workspace has no connection", async () => {
    fixtures.integrationConnection = [
      {
        provider: "GITHUB",
        status: "ERROR",
        lastSyncedAt: null,
        lastSyncError: "UNAUTHORIZED (HTTP 401)",
        workspaceId: FOREIGN,
      },
    ];

    expect(await getProviderSearchState(OWNER, new Date("2026-10-28T12:00:00Z"))).toEqual({
      kind: "not_connected",
    });
  });
});
