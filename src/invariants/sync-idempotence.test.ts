import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderIssue, ProviderMilestone, ProviderProject } from "@/modules/integrations/domain";

/**
 * Invariant 5 — synchronisation is re-runnable without duplicates.
 *
 * The real `saveSnapshots`, `saveIssues` and `saveMilestones` run against an in-memory
 * stand-in for the three snapshot tables, which honours their unique key
 * (connectionId, externalId). Replaying a run must leave the same rows, report no
 * creation, and prune only what the provider stopped returning — for issues and
 * milestones, only inside repositories read in full this run (DA-04).
 */

type Row = Record<string, unknown> & { connectionId: string; externalId: string };
const tables = new Map<string, Map<string, Row>>();
/** Negative control switch: the store forgets its unique key and appends every upsert. */
let brokenUniqueKey = false;
let appendCounter = 0;

function table(model: string): Map<string, Row> {
  let rows = tables.get(model);
  if (!rows) tables.set(model, (rows = new Map()));
  return rows;
}

function inMemoryModel(model: string) {
  return {
    findMany: async ({ where }: { where: { connectionId: string } }) =>
      [...table(model).values()].filter((row) => row.connectionId === where.connectionId),
    upsert: async (args: {
      where: { connectionId_externalId: { connectionId: string; externalId: string } };
      create: Row;
      update: Record<string, unknown>;
    }) => {
      const { connectionId, externalId } = args.where.connectionId_externalId;
      const key = brokenUniqueKey
        ? `${connectionId}/${externalId}#${(appendCounter += 1)}`
        : `${connectionId}/${externalId}`;
      const existing = table(model).get(key);
      const row = existing ? { ...existing, ...args.update } : { ...args.create };
      table(model).set(key, row);
      return row;
    },
    deleteMany: async ({ where }: { where: Where }) => {
      let count = 0;
      for (const [key, row] of table(model)) {
        if (matches(row, where)) {
          table(model).delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };
}

/** The subset of Prisma `where` the save functions use: equality, `in`, `notIn`, `OR`. */
type Where = { OR?: Where[] } & Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "OR") return (condition as Where[]).some((branch) => matches(row, branch));
    if (condition !== null && typeof condition === "object") {
      const { in: included, notIn } = condition as { in?: unknown[]; notIn?: unknown[] };
      return (!included || included.includes(row[field])) && (!notIn || !notIn.includes(row[field]));
    }
    return row[field] === condition;
  });
}

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    projectSnapshot: inMemoryModel("projectSnapshot"),
    issueSnapshot: inMemoryModel("issueSnapshot"),
    milestoneSnapshot: inMemoryModel("milestoneSnapshot"),
  }),
}));

const { saveIssues, saveMilestones, saveSnapshots } = await import("@/modules/integrations/repository");

const FETCHED_AT = new Date("2026-10-01T08:00:00.000Z");
const CONNECTION = "connection-fixture";

function project(id: string): ProviderProject {
  return { externalId: id, externalUrl: `https://example.test/${id}`, name: `Projet ${id}`, visibility: "private", metrics: { stars: 1 } };
}

const REPO_A = "fictif/depot-a";
const REPO_B = "fictif/depot-b";

function issue(id: string, repository = REPO_A): ProviderIssue {
  return {
    externalId: id,
    kind: "ISSUE",
    repository,
    number: Number(id.replace(/\D/g, "")) || 1,
    title: `Ticket ${id}`,
    url: `https://example.test/issues/${id}`,
    authorLogin: "fictif",
    assignees: [],
    milestone: null,
    commentsCount: 0,
    labels: [],
    openedAt: FETCHED_AT,
    activityAt: FETCHED_AT,
  } as ProviderIssue;
}

function milestone(id: string, repository = REPO_A): ProviderMilestone {
  return {
    externalId: id,
    repository,
    number: 1,
    title: `Jalon ${id}`,
    state: "open",
    dueOn: null,
    issuesOpen: 1,
    issuesClosed: 0,
    url: `https://example.test/milestones/${id}`,
  };
}

/**
 * One run. `read` lists the repositories answered in full (their missing items are
 * closed); `tracked` every repository still followed. A partial run reads fewer.
 */
async function runOnce(
  projects: string[],
  issues: ProviderIssue[],
  milestones: ProviderMilestone[],
  { read = [REPO_A, REPO_B], tracked = [REPO_A, REPO_B], pruneProjects = true } = {},
) {
  const common = { connectionId: CONNECTION, provider: "GITHUB" as const, fetchedAt: FETCHED_AT };
  return {
    projects: await saveSnapshots({ ...common, projects: projects.map(project), pruneMissing: pruneProjects }),
    issues: await saveIssues({ ...common, issues, readRepositories: read, trackedRepositories: tracked }),
    milestones: await saveMilestones({ ...common, milestones, readRepositories: read, trackedRepositories: tracked }),
  };
}

function snapshot() {
  return Object.fromEntries([...tables].map(([model, rows]) => [model, [...rows.keys()].sort()]));
}

describe("invariant: idempotent synchronisation", () => {
  beforeEach(() => {
    tables.clear();
    brokenUniqueKey = false;
  });

  it("replaying the same run changes nothing and creates nothing", async () => {
    const issues = [issue("i1"), issue("i2"), issue("i3", REPO_B)];
    const first = await runOnce(["p1", "p2"], issues, [milestone("m1")]);
    const afterFirst = snapshot();
    const second = await runOnce(["p1", "p2"], issues, [milestone("m1")]);

    expect(first.projects).toEqual({ created: 2, updated: 0 });
    expect(second.projects).toEqual({ created: 0, updated: 2 });
    expect(second.issues).toEqual({ created: 0, updated: 3 });
    expect(second.milestones).toEqual({ created: 0, updated: 1 });
    expect(snapshot()).toEqual(afterFirst);
  });

  it("a complete run prunes exactly what the provider no longer returns", async () => {
    await runOnce(["p1", "p2"], [issue("i1"), issue("i2")], [milestone("m1"), milestone("m2")]);
    await runOnce(["p2", "p3"], [issue("i2")], [milestone("m2")]);

    expect(snapshot()).toEqual({
      projectSnapshot: [`${CONNECTION}/p2`, `${CONNECTION}/p3`],
      issueSnapshot: [`${CONNECTION}/i2`],
      milestoneSnapshot: [`${CONNECTION}/m2`],
    });
  });

  it("a repository not read in full (304, bound, refused) keeps its rows", async () => {
    await runOnce(["p1"], [issue("a1"), issue("b1", REPO_B)], [milestone("ma"), milestone("mb", REPO_B)]);
    // Only REPO_A answered in full and nothing changed there; REPO_B was not read.
    await runOnce(["p1"], [issue("a1")], [milestone("ma")], { read: [REPO_A], pruneProjects: false });

    expect(snapshot().issueSnapshot).toEqual([`${CONNECTION}/a1`, `${CONNECTION}/b1`]);
    expect(snapshot().milestoneSnapshot).toEqual([`${CONNECTION}/ma`, `${CONNECTION}/mb`]);
  });

  it("a repository no longer tracked loses its rows", async () => {
    await runOnce(["p1"], [issue("a1"), issue("b1", REPO_B)], [milestone("mb", REPO_B)]);
    await runOnce(["p1"], [issue("a1")], [], { read: [REPO_A], tracked: [REPO_A] });

    expect(snapshot().issueSnapshot).toEqual([`${CONNECTION}/a1`]);
    expect(snapshot().milestoneSnapshot).toEqual([]);
  });

  it("negative control: without the unique key, the same replay is caught duplicating", async () => {
    brokenUniqueKey = true;
    await runOnce(["p1", "p2"], [], [], { read: [], pruneProjects: false });
    const afterFirst = snapshot();
    await runOnce(["p1", "p2"], [], [], { read: [], pruneProjects: false });

    expect(snapshot()).not.toEqual(afterFirst);
    expect(snapshot().projectSnapshot).toHaveLength(4);
  });
});
