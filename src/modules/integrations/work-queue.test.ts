import { describe, expect, it } from "vitest";
import {
  BLOCKED_LABELS,
  buildWorkQueue,
  isBlocked,
  isOldPullRequest,
  isWithoutLabels,
  isWithoutMilestone,
  queueReasonsFor,
  type QueueIssue,
  type QueueMilestone,
} from "./work-queue";

/** Fictitious data only, with a fixed clock so ages are exact. */
const NOW = new Date("2026-03-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

function issue(overrides: Partial<QueueIssue> = {}): QueueIssue {
  return {
    id: overrides.id ?? "issue-1",
    kind: overrides.kind ?? "ISSUE",
    repository: overrides.repository ?? "acme/app",
    number: overrides.number ?? 1,
    title: overrides.title ?? "Sujet de test",
    url: overrides.url ?? "https://example.test/issues/1",
    assignees: overrides.assignees ?? [],
    milestone: overrides.milestone ?? null,
    labels: overrides.labels ?? [],
    commentsCount: overrides.commentsCount ?? 0,
    openedAt: overrides.openedAt ?? daysAgo(0),
    activityAt: overrides.activityAt ?? daysAgo(0),
  };
}

function milestone(overrides: Partial<QueueMilestone> = {}): QueueMilestone {
  return {
    repository: overrides.repository ?? "acme/app",
    number: overrides.number ?? 1,
    title: overrides.title ?? "v1",
    state: overrides.state ?? "open",
    dueOn: overrides.dueOn ?? null,
    issuesOpen: overrides.issuesOpen ?? 0,
    issuesClosed: overrides.issuesClosed ?? 0,
    url: overrides.url ?? "https://example.test/milestones/1",
  };
}

describe("isBlocked", () => {
  it("matches a blocked label case-insensitively", () => {
    expect(isBlocked({ labels: ["Blocked"] })).toBe(true);
    expect(isBlocked({ labels: ["EN ATTENTE"] })).toBe(true);
  });

  it("does not flag an unrelated label", () => {
    expect(isBlocked({ labels: ["bug", "docs"] })).toBe(false);
  });

  it("accepts a custom label list", () => {
    expect(isBlocked({ labels: ["coincé"] }, ["coincé"])).toBe(true);
    expect(isBlocked({ labels: ["blocked"] }, ["coincé"])).toBe(false);
  });
});

describe("isOldPullRequest", () => {
  it("flags a pull request at or past the threshold", () => {
    expect(isOldPullRequest({ kind: "PULL_REQUEST", openedAt: daysAgo(14) }, NOW, 14)).toBe(true);
    expect(isOldPullRequest({ kind: "PULL_REQUEST", openedAt: daysAgo(13) }, NOW, 14)).toBe(false);
  });

  it("never flags an issue, however old", () => {
    expect(isOldPullRequest({ kind: "ISSUE", openedAt: daysAgo(400) }, NOW, 14)).toBe(false);
  });
});

describe("isWithoutMilestone", () => {
  it("flags an issue with no milestone, not one that has some", () => {
    expect(isWithoutMilestone({ kind: "ISSUE", milestone: null })).toBe(true);
    expect(isWithoutMilestone({ kind: "ISSUE", milestone: "v1" })).toBe(false);
  });

  it("never flags a pull request", () => {
    expect(isWithoutMilestone({ kind: "PULL_REQUEST", milestone: null })).toBe(false);
  });
});

describe("isWithoutLabels", () => {
  it("flags an unlabelled row and clears a labelled one", () => {
    expect(isWithoutLabels({ labels: [] })).toBe(true);
    expect(isWithoutLabels({ labels: ["bug"] })).toBe(false);
  });
});

describe("queueReasonsFor", () => {
  it("collects every rule an issue satisfies", () => {
    const reasons = queueReasonsFor(
      issue({ kind: "ISSUE", milestone: null, labels: [], commentsCount: 0, openedAt: daysAgo(10) }),
      { now: NOW },
    );

    expect(reasons).toEqual(["unanswered", "withoutMilestone", "withoutLabels"]);
  });

  it("returns nothing for a fresh, labelled, milestoned row", () => {
    const reasons = queueReasonsFor(
      issue({
        kind: "PULL_REQUEST",
        milestone: "v1",
        labels: ["bug"],
        commentsCount: 4,
        openedAt: daysAgo(1),
      }),
      { now: NOW },
    );

    expect(reasons).toEqual([]);
  });

  it("honours a custom old-pull-request threshold", () => {
    const pr = issue({ kind: "PULL_REQUEST", labels: ["bug"], milestone: "v1", commentsCount: 1, openedAt: daysAgo(5) });

    expect(queueReasonsFor(pr, { now: NOW, oldPullRequestDays: 3 })).toContain("oldPullRequest");
    expect(queueReasonsFor(pr, { now: NOW, oldPullRequestDays: 30 })).not.toContain("oldPullRequest");
  });
});

describe("buildWorkQueue", () => {
  it("returns empty buckets and no milestones for no data", () => {
    const queue = buildWorkQueue([], [], { now: NOW });

    expect(queue.totalItems).toBe(0);
    expect(queue.buckets.every((bucket) => bucket.items.length === 0)).toBe(true);
    expect(queue.milestones.overdue).toHaveLength(0);
    expect(queue.milestones.dueSoon).toHaveLength(0);
  });

  it("lists an item in every bucket it belongs to", () => {
    const stuck = issue({
      id: "stuck",
      kind: "ISSUE",
      milestone: null,
      labels: ["blocked"],
      commentsCount: 0,
      openedAt: daysAgo(10),
    });

    const queue = buildWorkQueue([stuck], [], { now: NOW });
    const bucketFor = (reason: string) => queue.buckets.find((bucket) => bucket.reason === reason)!;

    expect(bucketFor("unanswered").items).toHaveLength(1);
    expect(bucketFor("withoutMilestone").items).toHaveLength(1);
    expect(bucketFor("blocked").items).toHaveLength(1);
    // Has a label, so it is not "without labels".
    expect(bucketFor("withoutLabels").items).toHaveLength(0);
    expect(queue.totalItems).toBe(1);
  });

  it("orders a bucket oldest first", () => {
    const older = issue({ id: "older", kind: "PULL_REQUEST", labels: ["a"], milestone: "v1", commentsCount: 2, openedAt: daysAgo(40) });
    const newer = issue({ id: "newer", kind: "PULL_REQUEST", labels: ["a"], milestone: "v1", commentsCount: 2, openedAt: daysAgo(20) });

    const queue = buildWorkQueue([newer, older], [], { now: NOW });
    const bucket = queue.buckets.find((entry) => entry.reason === "oldPullRequest")!;

    expect(bucket.items.map((item) => item.issue.id)).toEqual(["older", "newer"]);
  });

  it("splits milestones into overdue and due-soon, ignoring closed and undated ones", () => {
    const queue = buildWorkQueue(
      [],
      [
        milestone({ number: 1, dueOn: new Date(NOW.getTime() - 2 * DAY) }),
        milestone({ number: 2, dueOn: new Date(NOW.getTime() + 7 * DAY) }),
        milestone({ number: 3, dueOn: new Date(NOW.getTime() + 8 * DAY) }),
        milestone({ number: 4, dueOn: null }),
        milestone({ number: 5, state: "closed", dueOn: new Date(NOW.getTime() - 10 * DAY) }),
      ],
      { now: NOW },
    );

    expect(queue.milestones.overdue.map((entry) => entry.number)).toEqual([1]);
    expect(queue.milestones.dueSoon.map((entry) => entry.number)).toEqual([2]);
  });

  it("exposes the thresholds it used", () => {
    const queue = buildWorkQueue([], [], { now: NOW });

    expect(queue.thresholds).toEqual({
      unansweredDays: 3,
      oldPullRequestDays: 14,
      milestoneDueSoonDays: 7,
    });
  });

  it("uses the default blocked label list", () => {
    expect(BLOCKED_LABELS).toContain("blocked");
    expect(BLOCKED_LABELS).toContain("en attente");
  });
});
