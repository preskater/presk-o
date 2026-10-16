import type { IssueKind } from "./domain";
import {
  ageInDays,
  isQuestion,
  isUnanswered,
  DEFAULT_UNANSWERED_DAYS,
} from "./issues";
import { describeMilestoneDue, type MilestoneLike } from "./milestones";

/**
 * The actionable work queue (DA-01).
 *
 * The explorer answers "show me the issues matching these filters"; this answers a
 * different question — "what needs attention now?". Every rule below is defined here
 * and nowhere else, reuses the predicates the explorer and the badges already use (so
 * a queue rule and a badge can never disagree), and is documented in
 * `docs/architecture/overview.md` before being displayed.
 *
 * Everything is computed from **already stored** data (open issues/PRs and
 * milestones): no new provider call is made. The one signal that would need one —
 * pull request review state — is therefore not offered, and the interface says so
 * rather than inventing it (see `WorkQueueCard`).
 *
 * A missing value is never a fabricated zero: an issue without a milestone or a
 * label is a real state, and a milestone without a due date is never "due soon".
 */

export const QUEUE_REASONS = [
  "unanswered",
  "oldPullRequest",
  "withoutMilestone",
  "withoutLabels",
  "blocked",
] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

/** How long an open pull request can sit before it joins the queue. */
export const DEFAULT_OLD_PULL_REQUEST_DAYS = 14;
/** A milestone is "due soon" within this many days (overdue always qualifies). */
export const DEFAULT_MILESTONE_DUE_SOON_DAYS = 7;

/**
 * Labels that mean a piece of work is stuck. Compared case-insensitively against the
 * stored label names; the convention is documented rather than configurable here so
 * the queue stays a pure function.
 */
export const BLOCKED_LABELS = [
  "blocked",
  "bloqué",
  "bloquée",
  "on hold",
  "waiting",
  "en attente",
] as const;

/** The fields a queue rule reads. Repository rows satisfy this structurally. */
export type QueueIssue = {
  id: string;
  kind: IssueKind;
  repository: string;
  number: number;
  title: string;
  url: string;
  assignees: string[];
  milestone: string | null;
  labels: string[];
  commentsCount: number;
  openedAt: Date;
  activityAt: Date;
};

export type QueueMilestone = MilestoneLike & {
  repository: string;
  number: number;
  url: string;
};

export type WorkQueueItem<TIssue extends QueueIssue = QueueIssue> = {
  issue: TIssue;
  /** Every rule this issue satisfies: one issue may call for several actions. */
  reasons: QueueReason[];
  /** Whole days since it was opened, floored. */
  ageDays: number;
};

export type WorkQueueBucket<TIssue extends QueueIssue = QueueIssue> = {
  reason: QueueReason;
  /** Short French heading. */
  label: string;
  /** One line explaining why the bucket exists, shown next to it. */
  rationale: string;
  items: WorkQueueItem<TIssue>[];
};

export type MilestoneDueBucket<TMilestone extends QueueMilestone = QueueMilestone> = {
  overdue: TMilestone[];
  dueSoon: TMilestone[];
  dueSoonDays: number;
};

export type WorkQueue<
  TIssue extends QueueIssue = QueueIssue,
  TMilestone extends QueueMilestone = QueueMilestone,
> = {
  buckets: WorkQueueBucket<TIssue>[];
  milestones: MilestoneDueBucket<TMilestone>;
  /** Distinct issues placed in at least one bucket. */
  totalItems: number;
  thresholds: {
    unansweredDays: number;
    oldPullRequestDays: number;
    milestoneDueSoonDays: number;
  };
};

/** True when a label marks the work as blocked (case-insensitive, whitespace-trimmed). */
export function isBlocked(
  issue: Pick<QueueIssue, "labels">,
  blockedLabels: readonly string[] = BLOCKED_LABELS,
): boolean {
  const normalized = new Set(blockedLabels.map((label) => label.trim().toLowerCase()));

  return issue.labels.some((label) => normalized.has(label.trim().toLowerCase()));
}

/** An open pull request is "old" once it has sat for at least `days`. Issues are not. */
export function isOldPullRequest(
  issue: Pick<QueueIssue, "kind" | "openedAt">,
  now: Date,
  days: number,
): boolean {
  return issue.kind === "PULL_REQUEST" && ageInDays(issue.openedAt, now) >= days;
}

/** An issue with no milestone: nothing attaches it to a deadline. Pull requests excluded. */
export function isWithoutMilestone(
  issue: Pick<QueueIssue, "kind" | "milestone">,
): boolean {
  return isQuestion(issue) && issue.milestone === null;
}

/** Nothing labels the work: no nature, no priority signalled. */
export function isWithoutLabels(issue: Pick<QueueIssue, "labels">): boolean {
  return issue.labels.length === 0;
}

/** Every queue rule this issue satisfies, in the fixed display order. */
export function queueReasonsFor(
  issue: QueueIssue,
  options: {
    now?: Date;
    unansweredDays?: number;
    oldPullRequestDays?: number;
    blockedLabels?: readonly string[];
  } = {},
): QueueReason[] {
  const now = options.now ?? new Date();
  const unansweredDays = options.unansweredDays ?? DEFAULT_UNANSWERED_DAYS;
  const oldPullRequestDays = options.oldPullRequestDays ?? DEFAULT_OLD_PULL_REQUEST_DAYS;
  const blockedLabels = options.blockedLabels ?? BLOCKED_LABELS;

  const reasons: QueueReason[] = [];

  if (isUnanswered(issue, now, unansweredDays)) {
    reasons.push("unanswered");
  }
  if (isOldPullRequest(issue, now, oldPullRequestDays)) {
    reasons.push("oldPullRequest");
  }
  if (isWithoutMilestone(issue)) {
    reasons.push("withoutMilestone");
  }
  if (isWithoutLabels(issue)) {
    reasons.push("withoutLabels");
  }
  if (isBlocked(issue, blockedLabels)) {
    reasons.push("blocked");
  }

  return reasons;
}

const BUCKET_META: Record<QueueReason, { label: string; rationale: string }> = {
  unanswered: {
    label: "Sans réponse",
    rationale: "Ouvertes, aucun commentaire : personne ne s'en est occupé.",
  },
  oldPullRequest: {
    label: "Pull requests anciennes",
    rationale:
      "Ouvertes depuis un moment et ni fusionnées ni fermées : à relancer, fusionner ou fermer.",
  },
  withoutMilestone: {
    label: "Issues sans jalon",
    rationale: "Aucun jalon ne les rattache à une échéance.",
  },
  withoutLabels: {
    label: "Sans étiquette",
    rationale: "Aucune nature ni priorité signalée.",
  },
  blocked: {
    label: "Travaux bloqués",
    rationale: "Une étiquette indique un blocage (« blocked », « en attente »…).",
  },
};

/**
 * Builds the queue.
 *
 * One issue can land in several buckets (`reasons`): a blocked, unlabelled, old pull
 * request is three reasons to look at it, and each bucket lists it where the action
 * belongs. Inside a bucket, items are ordered oldest first — the backlog order, which
 * is the order that matters for a queue. Milestones are split into overdue and
 * due-soon, and a closed or undated milestone never appears (a finished milestone is
 * not late).
 */
export function buildWorkQueue<
  TIssue extends QueueIssue,
  TMilestone extends QueueMilestone,
>(
  issues: readonly TIssue[],
  milestones: readonly TMilestone[],
  options: {
    now?: Date;
    unansweredDays?: number;
    oldPullRequestDays?: number;
    milestoneDueSoonDays?: number;
    blockedLabels?: readonly string[];
  } = {},
): WorkQueue<TIssue, TMilestone> {
  const now = options.now ?? new Date();
  const unansweredDays = options.unansweredDays ?? DEFAULT_UNANSWERED_DAYS;
  const oldPullRequestDays = options.oldPullRequestDays ?? DEFAULT_OLD_PULL_REQUEST_DAYS;
  const milestoneDueSoonDays =
    options.milestoneDueSoonDays ?? DEFAULT_MILESTONE_DUE_SOON_DAYS;

  const itemsByReason = new Map<QueueReason, WorkQueueItem<TIssue>[]>();
  for (const reason of QUEUE_REASONS) {
    itemsByReason.set(reason, []);
  }

  let totalItems = 0;

  for (const issue of issues) {
    const reasons = queueReasonsFor(issue, {
      now,
      unansweredDays,
      oldPullRequestDays,
      blockedLabels: options.blockedLabels,
    });

    if (reasons.length === 0) {
      continue;
    }

    totalItems += 1;
    const item: WorkQueueItem<TIssue> = {
      issue,
      reasons,
      ageDays: ageInDays(issue.openedAt, now),
    };

    for (const reason of reasons) {
      itemsByReason.get(reason)!.push(item);
    }
  }

  const buckets: WorkQueueBucket<TIssue>[] = QUEUE_REASONS.map((reason) => ({
    reason,
    label: BUCKET_META[reason].label,
    rationale: BUCKET_META[reason].rationale,
    items: itemsByReason
      .get(reason)!
      .sort((left, right) => left.issue.openedAt.getTime() - right.issue.openedAt.getTime()),
  }));

  const overdue: TMilestone[] = [];
  const dueSoon: TMilestone[] = [];

  for (const milestone of milestones) {
    const due = describeMilestoneDue(milestone, now);

    if (due.kind === "overdue") {
      overdue.push(milestone);
    } else if (due.kind === "upcoming" && due.days <= milestoneDueSoonDays) {
      dueSoon.push(milestone);
    }
  }

  // Both lists read soonest-due first (overdue: most overdue first).
  overdue.sort((left, right) => dueTime(left) - dueTime(right));
  dueSoon.sort((left, right) => dueTime(left) - dueTime(right));

  return {
    buckets,
    milestones: { overdue, dueSoon, dueSoonDays: milestoneDueSoonDays },
    totalItems,
    thresholds: {
      unansweredDays,
      oldPullRequestDays,
      milestoneDueSoonDays,
    },
  };
}

function dueTime(milestone: QueueMilestone): number {
  return milestone.dueOn ? milestone.dueOn.getTime() : 0;
}
