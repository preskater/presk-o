import { describe, expect, it } from "vitest";
import {
  buildActivityMetrics,
  DEFAULT_INACTIVE_DAYS,
  median,
  projectLastActivity,
  type MetricIssue,
  type MetricProject,
} from "./metrics";
import type { MilestoneLike } from "./milestones";

/** Fictitious data only, with a fixed clock so ages are exact. */
const NOW = new Date("2026-03-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const pullRequest = (age: number): MetricIssue => ({
  kind: "PULL_REQUEST",
  openedAt: daysAgo(age),
});
const issue = (age: number): MetricIssue => ({ kind: "ISSUE", openedAt: daysAgo(age) });

function milestone(overrides: Partial<MilestoneLike> = {}): MilestoneLike {
  return {
    title: overrides.title ?? "v1",
    state: overrides.state ?? "open",
    dueOn: overrides.dueOn ?? null,
    issuesOpen: overrides.issuesOpen ?? 0,
    issuesClosed: overrides.issuesClosed ?? 0,
  };
}

const githubProject = (name: string, pushedAt: unknown): MetricProject => ({
  name,
  metrics: { lastPushAt: pushedAt },
});

const build = (
  input: {
    issues?: MetricIssue[];
    milestones?: MilestoneLike[];
    projects?: MetricProject[];
  },
  issueTracking = true,
) =>
  buildActivityMetrics(input.issues ?? [], input.milestones ?? [], input.projects ?? [], {
    now: NOW,
    issueTracking,
  });

describe("median", () => {
  it("is null for an empty list", () => {
    expect(median([])).toBeNull();
  });

  it("returns the single value", () => {
    expect(median([7])).toBe(7);
  });

  it("takes the middle of an odd, unsorted list", () => {
    expect(median([9, 1, 4])).toBe(4);
  });

  it("averages the two middle values of an even list", () => {
    expect(median([1, 2, 10, 20])).toBe(6);
  });
});

describe("projectLastActivity", () => {
  it("reads GitHub's last push", () => {
    expect(projectLastActivity({ lastPushAt: "2026-02-01T00:00:00Z" })).toEqual(
      new Date("2026-02-01T00:00:00Z"),
    );
  });

  it("reads GitLab's last activity", () => {
    expect(projectLastActivity({ lastActivityAt: "2026-02-01T00:00:00Z" })).toEqual(
      new Date("2026-02-01T00:00:00Z"),
    );
  });

  it("is unknown when the value is absent or unparsable", () => {
    expect(projectLastActivity(null)).toBeNull();
    expect(projectLastActivity({ lastPushAt: null })).toBeNull();
    expect(projectLastActivity({ lastPushAt: "pas une date" })).toBeNull();
    expect(projectLastActivity({ lastPushAt: 12 })).toBeNull();
  });
});

describe("buildActivityMetrics — pull requests", () => {
  it("counts zero open pull requests with no median, not a zero age", () => {
    const metrics = build({ issues: [issue(3)] });

    expect(metrics.pullRequests).toEqual({ available: true, openCount: 0, medianAgeDays: null });
  });

  it("handles a single pull request", () => {
    expect(build({ issues: [pullRequest(5)] }).pullRequests).toEqual({
      available: true,
      openCount: 1,
      medianAgeDays: 5,
    });
  });

  it("ignores issues and takes the median age of pull requests", () => {
    const metrics = build({
      issues: [pullRequest(1), pullRequest(3), pullRequest(30), pullRequest(10), issue(400)],
    });

    expect(metrics.pullRequests).toEqual({ available: true, openCount: 4, medianAgeDays: 6.5 });
  });

  it("floors ages at the day boundary", () => {
    const justUnderTwoDays = { kind: "PULL_REQUEST" as const, openedAt: new Date(NOW.getTime() - 2 * DAY + 1) };

    expect(build({ issues: [justUnderTwoDays] }).pullRequests).toMatchObject({ medianAgeDays: 1 });
  });

  it("is unavailable, not zero, when no connection reads pull requests", () => {
    const metrics = build({}, false);

    expect(metrics.pullRequests.available).toBe(false);
  });
});

describe("buildActivityMetrics — closed history", () => {
  it("always reports open-to-merge and throughput as unavailable", () => {
    const metrics = build({ issues: [pullRequest(2), issue(2)] });

    expect(metrics.openToMerge.available).toBe(false);
    expect(metrics.issueThroughput.available).toBe(false);
  });
});

describe("buildActivityMetrics — repository inactivity", () => {
  it("returns empty groups without projects", () => {
    expect(build({}).repositories).toEqual({
      inactiveDays: DEFAULT_INACTIVE_DAYS,
      inactive: [],
      active: [],
      unknown: [],
    });
  });

  it("splits at the threshold: exactly 30 days idle is inactive, 29 is not", () => {
    const metrics = build({
      projects: [
        githubProject("acme/quiet", daysAgo(30).toISOString()),
        githubProject("acme/busy", daysAgo(29).toISOString()),
      ],
    });

    expect(metrics.repositories.inactive.map((row) => row.name)).toEqual(["acme/quiet"]);
    expect(metrics.repositories.active.map((row) => row.name)).toEqual(["acme/busy"]);
  });

  it("keeps an undated repository unknown, never inactive", () => {
    const metrics = build({ projects: [githubProject("acme/new", null)] });

    expect(metrics.repositories.unknown).toEqual([
      { name: "acme/new", lastActivityAt: null, idleDays: null },
    ]);
    expect(metrics.repositories.inactive).toEqual([]);
  });

  it("orders inactive repositories longest idle first", () => {
    const metrics = build({
      projects: [
        githubProject("acme/a", daysAgo(40).toISOString()),
        { name: "group/b", metrics: { lastActivityAt: daysAgo(90).toISOString() } },
      ],
    });

    expect(metrics.repositories.inactive.map((row) => row.idleDays)).toEqual([90, 40]);
  });
});

describe("buildActivityMetrics — milestones", () => {
  it("has no completion without milestones", () => {
    expect(build({}).milestones).toEqual({ openCount: 0, closedCount: 0, openCompletion: null });
  });

  it("has no completion when open milestones carry no item", () => {
    expect(build({ milestones: [milestone()] }).milestones.openCompletion).toBeNull();
  });

  it("aggregates the provider counters of open milestones only", () => {
    const metrics = build({
      milestones: [
        milestone({ issuesOpen: 1, issuesClosed: 3 }),
        milestone({ issuesOpen: 3, issuesClosed: 1 }),
        milestone({ state: "closed", issuesOpen: 0, issuesClosed: 50 }),
      ],
    });

    expect(metrics.milestones).toEqual({ openCount: 2, closedCount: 1, openCompletion: 0.5 });
  });
});
