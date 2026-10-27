import { directionFactor, type TableSort } from "@/lib/table-sort";
import type { IssueKind } from "./domain";
import { ageInDays } from "./issues";
import { isMilestoneOpen, type MilestoneLike } from "./milestones";

/**
 * Development activity metrics (DA-02).
 *
 * Bounded, documented figures computed **only from stored snapshots** and a reference
 * instant: given the same rows and the same `now`, the result is identical. Every
 * definition is written in `docs/architecture/overview.md` before being displayed.
 *
 * The snapshots only keep *open* issues and pull requests (a closed row disappears at
 * the next synchronisation). Two metrics need closed history and are therefore
 * reported as unavailable rather than guessed: time from opening to merge, and issue
 * throughput. A row that vanished may have been closed, merged, transferred or simply
 * fallen out of the bounded fetch — counting it as "done" would invent a number.
 *
 * These are descriptions of a backlog, never a measure of people.
 */

/** A repository with no recorded activity for this many days reads as inactive. */
export const DEFAULT_INACTIVE_DAYS = 30;

/** Columns the repository activity table can be sorted by. */
export const ACTIVITY_SORT_KEYS = ["repository", "activity"] as const;
export type ActivitySortKey = (typeof ACTIVITY_SORT_KEYS)[number];

/** Default: "Dernière activité", smallest lapse first. */
export const DEFAULT_ACTIVITY_SORT: TableSort<ActivitySortKey> = {
  key: "activity",
  direction: "asc",
};

export const UNAVAILABLE_REASONS = {
  openToMerge:
    "Les snapshots ne gardent que les pull requests ouvertes : aucune date de fusion n'est enregistrée.",
  issueThroughput:
    "Les issues fermées ne sont pas conservées : une ligne disparue peut avoir été fermée, transférée ou sortir du périmètre lu.",
  noIssueTracking:
    "Aucune connexion ne remonte les pull requests (seul GitHub les lit aujourd'hui).",
} as const;

export type Unavailable = { available: false; reason: string };

export type MetricIssue = { kind: IssueKind; openedAt: Date };

export type MetricProject = {
  name: string;
  /** Provider-reported metrics, as stored on the project snapshot. */
  metrics: Record<string, unknown> | null;
};

export type RepositoryActivity = {
  name: string;
  /** `null` when the provider did not report a usable date: unknown, not inactive. */
  lastActivityAt: Date | null;
  /** Whole days since `lastActivityAt`, floored; `null` when unknown. */
  idleDays: number | null;
};

export type ActivityMetrics = {
  pullRequests:
    | Unavailable
    | {
        available: true;
        openCount: number;
        /** Median age in whole days; `null` when no pull request is open. */
        medianAgeDays: number | null;
      };
  openToMerge: Unavailable;
  issueThroughput: Unavailable;
  repositories: {
    inactiveDays: number;
    inactive: RepositoryActivity[];
    active: RepositoryActivity[];
    unknown: RepositoryActivity[];
  };
  milestones: {
    openCount: number;
    closedCount: number;
    /**
     * Share of the items attached to open milestones that are closed, between 0 and 1,
     * from the provider's counters. `null` when no open milestone has any item.
     */
    openCompletion: number | null;
  };
};

/** Median of a list; the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The last activity a provider reports for a project.
 *
 * GitHub gives `pushed_at` (last push, any branch); GitLab gives `last_activity_at`,
 * which also moves on issue and merge request activity. The two are not the same
 * signal and the documentation says so; an absent or unparsable value is unknown.
 */
export function projectLastActivity(metrics: Record<string, unknown> | null): Date | null {
  const value = metrics?.["lastPushAt"] ?? metrics?.["lastActivityAt"];
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;

  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Orders the repository activity table. By activity, a smaller lapse (more recent
 * activity) comes first ascending; a repository without a known date is always listed
 * last, whatever the direction — an unknown date is not "the oldest".
 */
export function sortRepositoryActivity<TRow extends RepositoryActivity>(
  rows: readonly TRow[],
  sort: TableSort<ActivitySortKey>,
): TRow[] {
  const factor = directionFactor(sort.direction);

  return [...rows].sort((left, right) => {
    if (sort.key === "activity") {
      if (left.idleDays === null || right.idleDays === null) {
        return (left.idleDays === null ? 1 : 0) - (right.idleDays === null ? 1 : 0) ||
          left.name.localeCompare(right.name);
      }

      return factor * (left.idleDays - right.idleDays) || left.name.localeCompare(right.name);
    }

    return factor * left.name.localeCompare(right.name);
  });
}

export function buildActivityMetrics(
  issues: readonly MetricIssue[],
  milestones: readonly MilestoneLike[],
  projects: readonly MetricProject[],
  options: { now?: Date; issueTracking: boolean; inactiveDays?: number },
): ActivityMetrics {
  const now = options.now ?? new Date();
  const inactiveDays = options.inactiveDays ?? DEFAULT_INACTIVE_DAYS;

  const pullRequestAges = issues
    .filter((issue) => issue.kind === "PULL_REQUEST")
    .map((issue) => ageInDays(issue.openedAt, now));

  const repositories: ActivityMetrics["repositories"] = {
    inactiveDays,
    inactive: [],
    active: [],
    unknown: [],
  };

  for (const project of projects) {
    const lastActivityAt = projectLastActivity(project.metrics);
    const idleDays = lastActivityAt ? ageInDays(lastActivityAt, now) : null;
    const row = { name: project.name, lastActivityAt, idleDays };

    if (idleDays === null) {
      repositories.unknown.push(row);
    } else if (idleDays >= inactiveDays) {
      repositories.inactive.push(row);
    } else {
      repositories.active.push(row);
    }
  }

  // Longest idle first: the repositories going quiet are the ones worth reading.
  repositories.inactive.sort((left, right) => right.idleDays! - left.idleDays!);
  repositories.active.sort((left, right) => right.idleDays! - left.idleDays!);
  repositories.unknown.sort((left, right) => left.name.localeCompare(right.name));

  const open = milestones.filter(isMilestoneOpen);
  const attachedClosed = open.reduce((sum, milestone) => sum + milestone.issuesClosed, 0);
  const attachedTotal = open.reduce(
    (sum, milestone) => sum + milestone.issuesOpen + milestone.issuesClosed,
    0,
  );

  return {
    pullRequests: options.issueTracking
      ? {
          available: true,
          openCount: pullRequestAges.length,
          medianAgeDays: median(pullRequestAges),
        }
      : { available: false, reason: UNAVAILABLE_REASONS.noIssueTracking },
    openToMerge: { available: false, reason: UNAVAILABLE_REASONS.openToMerge },
    issueThroughput: { available: false, reason: UNAVAILABLE_REASONS.issueThroughput },
    repositories,
    milestones: {
      openCount: open.length,
      closedCount: milestones.length - open.length,
      openCompletion: attachedTotal === 0 ? null : attachedClosed / attachedTotal,
    },
  };
}
