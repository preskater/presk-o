import { describe, expect, it } from "vitest";
import {
  buildRepositoryHealth,
  DEFAULT_BACKLOG_THRESHOLD,
  HEALTH_INDICATORS,
  milestoneScope,
  type HealthIndicator,
  type HealthMilestone,
  type HealthProject,
} from "./health";

/** Fictitious repositories only, with a fixed clock. */
const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

/** A healthy GitHub repository: every indicator reads it as fine. */
function project(overrides: Partial<HealthProject> = {}, metrics: Record<string, unknown> = {}): HealthProject {
  return {
    connectionId: overrides.connectionId ?? "connection-1",
    name: overrides.name ?? "acme/app",
    provider: overrides.provider ?? "GITHUB",
    url: overrides.url ?? "https://github.com/acme/app",
    metrics:
      overrides.metrics === undefined
        ? {
            defaultBranch: "main",
            openIssues: 3,
            lastPushAt: daysAgo(2),
            hasDescription: true,
            topicCount: 2,
            ...metrics,
          }
        : overrides.metrics,
  };
}

function milestone(overrides: Partial<HealthMilestone> = {}): HealthMilestone {
  return {
    repository: overrides.repository ?? "acme/app",
    title: overrides.title ?? "v1",
    state: overrides.state ?? "open",
    dueOn: overrides.dueOn === undefined ? null : overrides.dueOn,
    issuesOpen: overrides.issuesOpen ?? 1,
    issuesClosed: overrides.issuesClosed ?? 0,
  };
}

function report(
  indicator: HealthIndicator,
  projects: HealthProject[],
  milestones: HealthMilestone[] = [],
) {
  return buildRepositoryHealth(projects, milestones, { now: NOW }).find(
    (entry) => entry.indicator === indicator,
  )!;
}

describe("buildRepositoryHealth — general", () => {
  it("returns every indicator, empty, without repositories", () => {
    const reports = buildRepositoryHealth([], [], { now: NOW });

    expect(reports.map((entry) => entry.indicator)).toEqual([...HEALTH_INDICATORS]);
    for (const entry of reports) {
      expect(entry).toMatchObject({ flagged: [], unavailable: [], fineCount: 0 });
      expect(entry.rule.length).toBeGreaterThan(0);
    }
  });

  it("reads a healthy repository as fine everywhere", () => {
    for (const entry of buildRepositoryHealth([project()], [], { now: NOW })) {
      expect(entry).toMatchObject({ flagged: [], unavailable: [], fineCount: 1 });
    }
  });

  it("makes every metadata indicator unavailable, never fine, when the snapshot metadata is unreadable", () => {
    const reports = buildRepositoryHealth([project({ metrics: null })], [], { now: NOW });

    for (const entry of reports.filter((row) => row.indicator !== "staleMilestones")) {
      expect(entry.fineCount).toBe(0);
      expect(entry.flagged).toEqual([]);
      expect(entry.unavailable).toHaveLength(1);
    }
  });

  it("still judges milestones, which are read on their own, when the project metadata is unreadable", () => {
    const entry = report(
      "staleMilestones",
      [project({ metrics: null })],
      [milestone({ dueOn: new Date(NOW.getTime() - DAY) })],
    );

    expect(entry.flagged).toHaveLength(1);
  });

  it("keeps the provider link on every flagged repository", () => {
    const flagged = report("missingDescription", [project({}, { hasDescription: false })]).flagged;

    expect(flagged[0].project.url).toBe("https://github.com/acme/app");
  });
});

describe("inactive", () => {
  it("flags 30 days idle and not 29 (the activity metrics threshold)", () => {
    const entry = report("inactive", [
      project({ name: "acme/quiet" }, { lastPushAt: daysAgo(30) }),
      project({ name: "acme/busy" }, { lastPushAt: daysAgo(29) }),
    ]);

    expect(entry.flagged.map((row) => row.project.name)).toEqual(["acme/quiet"]);
    expect(entry.fineCount).toBe(1);
  });

  it("reads GitLab's last activity", () => {
    const entry = report("inactive", [
      project({ provider: "GITLAB" }, { lastPushAt: undefined, lastActivityAt: daysAgo(90) }),
    ]);

    expect(entry.flagged[0].detail).toContain("90 j");
  });

  it("is unavailable without a usable date", () => {
    expect(report("inactive", [project({}, { lastPushAt: null })]).unavailable).toHaveLength(1);
  });
});

describe("issueBacklog", () => {
  it("flags at the threshold, not below", () => {
    const entry = report("issueBacklog", [
      project({ name: "acme/big" }, { openIssues: DEFAULT_BACKLOG_THRESHOLD }),
      project({ name: "acme/small" }, { openIssues: DEFAULT_BACKLOG_THRESHOLD - 1 }),
    ]);

    expect(entry.flagged.map((row) => row.project.name)).toEqual(["acme/big"]);
  });

  it("says GitHub's counter includes pull requests", () => {
    expect(report("issueBacklog", [project({}, { openIssues: 40 })]).flagged[0].detail).toContain(
      "pull requests",
    );
  });

  it("is unavailable without a counter", () => {
    expect(report("issueBacklog", [project({}, { openIssues: null })]).unavailable).toHaveLength(1);
  });
});

describe("staleMilestones", () => {
  it("flags an open overdue milestone only", () => {
    const entry = report(
      "staleMilestones",
      [project()],
      [
        milestone({ title: "v1", dueOn: new Date(NOW.getTime() - 3 * DAY) }),
        milestone({ title: "v0", state: "closed", dueOn: new Date(NOW.getTime() - 90 * DAY) }),
        milestone({ title: "v2", dueOn: new Date(NOW.getTime() + 3 * DAY) }),
        milestone({ title: "someday" }),
      ],
    );

    expect(entry.flagged).toHaveLength(1);
    expect(entry.flagged[0].detail).toBe("v1 (en retard de 3 j)");
  });

  it("reads a repository without milestones as fine when its milestones are read", () => {
    expect(report("staleMilestones", [project()]).fineCount).toBe(1);
  });

  it("is unavailable for a provider whose milestones are not read", () => {
    expect(report("staleMilestones", [project({ provider: "GITLAB" })]).unavailable).toHaveLength(1);
  });

  it("is unavailable for a repository outside the bounded selection", () => {
    const projects = Array.from({ length: 21 }, (_, index) =>
      project({ name: `acme/repo-${index}` }, { lastPushAt: daysAgo(index) }),
    );

    const entry = report("staleMilestones", projects);

    expect(entry.unavailable.map((row) => row.project.name)).toEqual(["acme/repo-20"]);
    expect(entry.fineCount).toBe(20);
  });
});

describe("milestoneScope", () => {
  it("bounds each connection separately", () => {
    const scope = milestoneScope(
      [
        project({ connectionId: "a", name: "acme/one" }, { lastPushAt: daysAgo(1) }),
        project({ connectionId: "a", name: "acme/two" }, { lastPushAt: daysAgo(2) }),
        project({ connectionId: "b", name: "other/one" }, { lastPushAt: daysAgo(9) }),
      ],
      1,
    );

    expect([...scope].sort()).toEqual(["a acme/one", "b other/one"]);
  });
});

describe("missingDescription and missingTopics", () => {
  it("flag a repository without description or topics", () => {
    const projects = [project({}, { hasDescription: false, topicCount: 0 })];

    expect(report("missingDescription", projects).flagged).toHaveLength(1);
    expect(report("missingTopics", projects).flagged).toHaveLength(1);
  });

  it("are unavailable on a snapshot taken before the fields were stored", () => {
    const projects = [project({}, { hasDescription: undefined, topicCount: undefined })];

    expect(report("missingDescription", projects).unavailable[0].reason).toContain("synchronisez");
    expect(report("missingTopics", projects).unavailable).toHaveLength(1);
  });

  it("are unavailable when the provider did not say", () => {
    const projects = [project({}, { hasDescription: null, topicCount: null })];

    expect(report("missingDescription", projects).unavailable).toHaveLength(1);
    expect(report("missingTopics", projects).unavailable).toHaveLength(1);
  });
});

describe("missingMetadata", () => {
  it("flags a repository without a default branch", () => {
    expect(report("missingMetadata", [project({}, { defaultBranch: null })]).flagged).toHaveLength(1);
  });

  it("is unavailable when the field was never reported", () => {
    const withoutKey = project();
    delete withoutKey.metrics!.defaultBranch;

    expect(report("missingMetadata", [withoutKey]).unavailable).toHaveLength(1);
  });
});
