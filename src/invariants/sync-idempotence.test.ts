import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderIssue, ProviderMilestone, ProviderProject } from "@/modules/integrations/domain";

/**
 * Invariant 5 — synchronisation is re-runnable without duplicates.
 *
 * The real `saveSnapshots`, `saveIssues` and `saveMilestones` run against an in-memory
 * stand-in for the three snapshot tables, which honours their unique key
 * (connectionId, externalId). Replaying a run must leave the same rows, report no
 * creation, and prune only what the provider stopped returning.
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
    deleteMany: async ({ where }: { where: { connectionId: string; externalId: { notIn: string[] } } }) => {
      let count = 0;
      for (const [key, row] of table(model)) {
        if (row.connectionId === where.connectionId && !where.externalId.notIn.includes(row.externalId)) {
          table(model).delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };
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

function issue(id: string): ProviderIssue {
  return {
    externalId: id,
    kind: "ISSUE",
    repository: "fictif/depot",
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

function milestone(id: string): ProviderMilestone {
  return {
    externalId: id,
    repository: "fictif/depot",
    number: 1,
    title: `Jalon ${id}`,
    state: "open",
    dueOn: null,
    issuesOpen: 1,
    issuesClosed: 0,
    url: `https://example.test/milestones/${id}`,
  };
}

async function runOnce(projects: string[], issues: string[], milestones: string[], pruneMissing = true) {
  return {
    projects: await saveSnapshots({ connectionId: CONNECTION, provider: "GITHUB", projects: projects.map(project), fetchedAt: FETCHED_AT, pruneMissing }),
    issues: await saveIssues({ connectionId: CONNECTION, provider: "GITHUB", issues: issues.map(issue), fetchedAt: FETCHED_AT, pruneMissing }),
    milestones: await saveMilestones({ connectionId: CONNECTION, provider: "GITHUB", milestones: milestones.map(milestone), fetchedAt: FETCHED_AT, pruneMissing }),
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
    const first = await runOnce(["p1", "p2"], ["i1", "i2", "i3"], ["m1"]);
    const afterFirst = snapshot();
    const second = await runOnce(["p1", "p2"], ["i1", "i2", "i3"], ["m1"]);

    expect(first.projects).toEqual({ created: 2, updated: 0 });
    expect(second.projects).toEqual({ created: 0, updated: 2 });
    expect(second.issues).toEqual({ created: 0, updated: 3 });
    expect(second.milestones).toEqual({ created: 0, updated: 1 });
    expect(snapshot()).toEqual(afterFirst);
  });

  it("a complete run prunes exactly what the provider no longer returns", async () => {
    await runOnce(["p1", "p2"], ["i1", "i2"], ["m1", "m2"]);
    await runOnce(["p2", "p3"], ["i2"], ["m2"]);

    expect(snapshot()).toEqual({
      projectSnapshot: [`${CONNECTION}/p2`, `${CONNECTION}/p3`],
      issueSnapshot: [`${CONNECTION}/i2`],
      milestoneSnapshot: [`${CONNECTION}/m2`],
    });
  });

  it("a partial run (no pruning) never erases what it did not read", async () => {
    await runOnce(["p1", "p2"], ["i1", "i2"], ["m1"]);
    await runOnce(["p1"], ["i1"], [], false);

    expect(snapshot().projectSnapshot).toHaveLength(2);
    expect(snapshot().issueSnapshot).toHaveLength(2);
    expect(snapshot().milestoneSnapshot).toHaveLength(1);
  });

  it("negative control: without the unique key, the same replay is caught duplicating", async () => {
    brokenUniqueKey = true;
    await runOnce(["p1", "p2"], [], [], false);
    const afterFirst = snapshot();
    await runOnce(["p1", "p2"], [], [], false);

    expect(snapshot()).not.toEqual(afterFirst);
    expect(snapshot().projectSnapshot).toHaveLength(4);
  });
});
