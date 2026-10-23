/**
 * CI status, as the dashboard reads it (DA-03).
 *
 * Pure functions over the stored runs and the per-repository read state: no provider
 * call, so the same rows always give the same view. Three repository states are kept
 * apart because they mean different things — a refused read is "unavailable", a read
 * with no run is "no workflow", and a repository outside the bounded selection was
 * simply "not read". None of them is a green check.
 */

export type CiOutcome = "failure" | "running" | "success" | "other";

export type CiRunLike = {
  workflowName: string;
  branch: string | null;
  status: string;
  conclusion: string | null;
  startedAt: Date;
  runUpdatedAt: Date;
};

export type CiRepositoryLike = {
  repository: string;
  provider: string;
  ciCheckedAt: Date | null;
  ciError: string | null;
  runs: CiRunLike[];
};

export type CiOverview<TRepository extends CiRepositoryLike> = {
  /** The latest run of each workflow, most recently started first. */
  latest: {
    repository: TRepository;
    run: TRepository["runs"][number];
    outcome: CiOutcome;
  }[];
  /** Read, but the provider returned no run at all. */
  withoutRuns: TRepository[];
  /** The read was refused or failed; `reason` is displayable. */
  unavailable: { repository: TRepository; reason: string }[];
  /** Never read: outside the bounded selection, or a provider without CI support. */
  notRead: TRepository[];
};

/** Conclusions that mean the workflow did not pass and someone should look. */
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

/**
 * A run that is not `completed` is running (queued, waiting, in progress). A
 * completed run is a failure, a success, or "other" — cancelled, skipped, neutral,
 * action required — which is reported as it is rather than counted as either.
 */
export function ciOutcome(run: Pick<CiRunLike, "status" | "conclusion">): CiOutcome {
  if (run.status !== "completed") {
    return "running";
  }

  if (run.conclusion === "success") {
    return "success";
  }

  return run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion) ? "failure" : "other";
}

/**
 * Wall-clock time from start to the provider's last update, in whole seconds.
 *
 * Only for a completed run: the last update is then its end. It includes queueing
 * between jobs, so it is not billed time. `null` while running.
 */
export function ciRunDurationSeconds(run: CiRunLike): number | null {
  if (run.status !== "completed") {
    return null;
  }

  return Math.max(0, Math.round((run.runUpdatedAt.getTime() - run.startedAt.getTime()) / 1000));
}

/** "4 min 05 s", "52 s", "1 h 03 min". */
export function formatCiDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  }

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Plain-French reason for a stored safe error code such as "UNAUTHORIZED (HTTP 403)". */
export function describeCiError(code: string): string {
  if (code.startsWith("UNAUTHORIZED")) {
    return "Accès refusé : le jeton n'a pas la permission « Actions » en lecture.";
  }

  if (code.startsWith("NOT_FOUND")) {
    return "Dépôt ou Actions introuvable pour ce jeton.";
  }

  if (code.startsWith("INVALID_RESPONSE")) {
    return "Réponse inattendue de GitHub : rien n'a été enregistré.";
  }

  return `Lecture impossible (${code}).`;
}

export function buildCiOverview<TRepository extends CiRepositoryLike>(
  repositories: readonly TRepository[],
): CiOverview<TRepository> {
  const overview: CiOverview<TRepository> = {
    latest: [],
    withoutRuns: [],
    unavailable: [],
    notRead: [],
  };

  for (const repository of repositories) {
    if (repository.ciCheckedAt === null) {
      overview.notRead.push(repository);
      continue;
    }

    if (repository.ciError !== null) {
      overview.unavailable.push({ repository, reason: describeCiError(repository.ciError) });
      continue;
    }

    if (repository.runs.length === 0) {
      overview.withoutRuns.push(repository);
      continue;
    }

    // Newest first, so the first run seen for a workflow is its latest one.
    const runs = [...repository.runs].sort(
      (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
    );
    const seen = new Set<string>();

    for (const run of runs) {
      if (seen.has(run.workflowName)) {
        continue;
      }
      seen.add(run.workflowName);
      overview.latest.push({ repository, run, outcome: ciOutcome(run) });
    }
  }

  // Most recently started first, so the last runs read first. Ties fall back to the
  // repository and workflow name, so the order is stable from one render to the next.
  overview.latest.sort(
    (left, right) =>
      right.run.startedAt.getTime() - left.run.startedAt.getTime() ||
      left.repository.repository.localeCompare(right.repository.repository) ||
      left.run.workflowName.localeCompare(right.run.workflowName),
  );

  return overview;
}
