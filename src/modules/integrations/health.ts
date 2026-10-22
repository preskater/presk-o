import type { IntegrationProvider } from "./domain";
import { DEFAULT_MAX_REPOSITORIES, selectRepositoriesToScan } from "./github";
import { ageInDays } from "./issues";
import { DEFAULT_INACTIVE_DAYS, projectLastActivity } from "./metrics";
import { describeMilestoneDue, type MilestoneLike } from "./milestones";

/**
 * Repository health indicators (DA-05).
 *
 * A to-do list of small hygiene gaps, computed from stored snapshots only: no provider
 * call, no write, nothing read from the source code. Every indicator states its rule,
 * and every repository it lists links to the provider, where the fix happens.
 *
 * Three outcomes per repository and indicator, never merged: flagged (the rule
 * matched), fine, or unavailable (the stored data cannot answer — a field the provider
 * did not report, a snapshot taken before the field was stored, a provider whose data
 * is not read). Unavailable is never counted as fine. There is no global score.
 */

/** An open issue counter at or above this reads as a backlog worth triaging. */
export const DEFAULT_BACKLOG_THRESHOLD = 25;

/** Providers whose milestones are read (see the GitLab adapter for why it is not). */
const MILESTONE_PROVIDERS: readonly IntegrationProvider[] = ["GITHUB"];

export const HEALTH_INDICATORS = [
  "inactive",
  "issueBacklog",
  "staleMilestones",
  "missingDescription",
  "missingTopics",
  "missingMetadata",
] as const;
export type HealthIndicator = (typeof HEALTH_INDICATORS)[number];

export type HealthProject = {
  connectionId: string;
  name: string;
  provider: IntegrationProvider;
  url: string;
  metrics: Record<string, unknown> | null;
};

export type HealthMilestone = MilestoneLike & { repository: string };

type Evaluation =
  | { state: "flagged"; detail: string }
  | { state: "fine" }
  | { state: "unavailable"; reason: string };

export type IndicatorReport<TProject extends HealthProject = HealthProject> = {
  indicator: HealthIndicator;
  label: string;
  /** The rule, in one sentence, as displayed. */
  rule: string;
  flagged: { project: TProject; detail: string }[];
  unavailable: { project: TProject; reason: string }[];
  fineCount: number;
};

const NOT_RESYNCED = "Pas encore relu depuis l'ajout de cet indicateur : synchronisez.";
const NO_METRICS = "Métadonnées du dépôt illisibles dans le dernier snapshot.";

function metric(project: HealthProject, key: string): unknown {
  return project.metrics?.[key];
}

function evaluateInactive(project: HealthProject, now: Date, inactiveDays: number): Evaluation {
  if (!project.metrics) {
    return { state: "unavailable", reason: NO_METRICS };
  }

  const lastActivity = projectLastActivity(project.metrics);
  if (!lastActivity) {
    return { state: "unavailable", reason: "Le fournisseur n'a pas donné de date d'activité." };
  }

  const idleDays = ageInDays(lastActivity, now);
  return idleDays >= inactiveDays
    ? { state: "flagged", detail: `Aucune activité depuis ${idleDays} j.` }
    : { state: "fine" };
}

function evaluateBacklog(project: HealthProject, threshold: number): Evaluation {
  if (!project.metrics) {
    return { state: "unavailable", reason: NO_METRICS };
  }

  const open = metric(project, "openIssues");
  if (typeof open !== "number") {
    return { state: "unavailable", reason: "Le fournisseur n'a pas donné de compteur d'issues." };
  }

  // GitHub's counter includes pull requests; GitLab's counts issues only.
  const what = project.provider === "GITHUB" ? "issues et pull requests ouvertes" : "issues ouvertes";
  return open >= threshold
    ? { state: "flagged", detail: `${open} ${what}.` }
    : { state: "fine" };
}

function evaluateStaleMilestones(
  project: HealthProject,
  milestones: readonly HealthMilestone[],
  milestonesRead: ReadonlySet<string>,
  now: Date,
): Evaluation {
  if (!MILESTONE_PROVIDERS.includes(project.provider)) {
    return { state: "unavailable", reason: "Les jalons de ce fournisseur ne sont pas lus." };
  }

  if (!milestonesRead.has(`${project.connectionId} ${project.name}`)) {
    return {
      state: "unavailable",
      reason: "Hors de la sélection lue (les dépôts les plus récemment poussés d'abord).",
    };
  }

  const overdue = milestones
    .filter((milestone) => milestone.repository === project.name)
    .map((milestone) => ({ milestone, due: describeMilestoneDue(milestone, now) }))
    .filter((entry) => entry.due.kind === "overdue");

  if (overdue.length === 0) {
    return { state: "fine" };
  }

  return {
    state: "flagged",
    detail: overdue
      .map(({ milestone, due }) =>
        due.kind === "overdue" ? `${milestone.title} (en retard de ${due.days} j)` : milestone.title,
      )
      .join(", "),
  };
}

function evaluateDescription(project: HealthProject): Evaluation {
  if (!project.metrics) {
    return { state: "unavailable", reason: NO_METRICS };
  }

  const hasDescription = metric(project, "hasDescription");
  if (typeof hasDescription !== "boolean") {
    return { state: "unavailable", reason: NOT_RESYNCED };
  }

  return hasDescription ? { state: "fine" } : { state: "flagged", detail: "Aucune description." };
}

function evaluateTopics(project: HealthProject): Evaluation {
  if (!project.metrics) {
    return { state: "unavailable", reason: NO_METRICS };
  }

  const topicCount = metric(project, "topicCount");
  if (typeof topicCount !== "number") {
    return { state: "unavailable", reason: NOT_RESYNCED };
  }

  return topicCount > 0 ? { state: "fine" } : { state: "flagged", detail: "Aucun topic." };
}

function evaluateMetadata(project: HealthProject): Evaluation {
  if (!project.metrics) {
    return { state: "unavailable", reason: NO_METRICS };
  }

  if (!("defaultBranch" in project.metrics)) {
    return { state: "unavailable", reason: "Le fournisseur n'a pas indiqué de branche par défaut." };
  }

  const defaultBranch = metric(project, "defaultBranch");
  return typeof defaultBranch === "string" && defaultBranch.length > 0
    ? { state: "fine" }
    : { state: "flagged", detail: "Aucune branche par défaut : dépôt vide ?" };
}

/**
 * The repositories whose milestones the synchronisation reads: the same bounded
 * selection as the issue fetch, per connection, most recently pushed first. It is the
 * adapter's own function, so the two can never disagree.
 */
export function milestoneScope(
  projects: readonly HealthProject[],
  maxRepositories: number = DEFAULT_MAX_REPOSITORIES,
): Set<string> {
  const byConnection = new Map<string, HealthProject[]>();

  for (const project of projects) {
    if (!MILESTONE_PROVIDERS.includes(project.provider)) {
      continue;
    }
    byConnection.set(project.connectionId, [...(byConnection.get(project.connectionId) ?? []), project]);
  }

  const scope = new Set<string>();
  for (const [connectionId, connectionProjects] of byConnection) {
    const { repositories } = selectRepositoriesToScan(
      connectionProjects.map((project) => ({
        externalId: project.name,
        externalUrl: project.url,
        name: project.name,
        visibility: null,
        metrics: project.metrics ?? {},
      })),
      maxRepositories,
    );
    for (const repository of repositories) {
      scope.add(`${connectionId} ${repository}`);
    }
  }

  return scope;
}

export function buildRepositoryHealth<TProject extends HealthProject>(
  projects: readonly TProject[],
  milestones: readonly HealthMilestone[],
  options: { now?: Date; inactiveDays?: number; backlogThreshold?: number } = {},
): IndicatorReport<TProject>[] {
  const now = options.now ?? new Date();
  const inactiveDays = options.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  const backlogThreshold = options.backlogThreshold ?? DEFAULT_BACKLOG_THRESHOLD;
  const milestonesRead = milestoneScope(projects);

  const definitions: Record<
    HealthIndicator,
    { label: string; rule: string; evaluate: (project: TProject) => Evaluation }
  > = {
    inactive: {
      label: "Dépôts inactifs",
      rule: `Dernière activité déclarée par le fournisseur il y a au moins ${inactiveDays} jours (même règle que les indicateurs d'activité).`,
      evaluate: (project) => evaluateInactive(project, now, inactiveDays),
    },
    issueBacklog: {
      label: "Backlog d'issues",
      rule: `Compteur d'issues ouvertes du fournisseur d'au moins ${backlogThreshold} (GitHub y inclut les pull requests).`,
      evaluate: (project) => evaluateBacklog(project, backlogThreshold),
    },
    staleMilestones: {
      label: "Jalons en retard",
      rule: "Au moins un jalon ouvert dont l'échéance est passée. Un jalon fermé ou sans date n'est jamais en retard.",
      evaluate: (project) => evaluateStaleMilestones(project, milestones, milestonesRead, now),
    },
    missingDescription: {
      label: "Sans description",
      rule: "Le dépôt n'a pas de description (seule sa présence est enregistrée, jamais son texte).",
      evaluate: evaluateDescription,
    },
    missingTopics: {
      label: "Sans topics",
      rule: "Le dépôt n'a aucun topic pour le classer.",
      evaluate: evaluateTopics,
    },
    missingMetadata: {
      label: "Métadonnées manquantes",
      rule: "Le dépôt n'a pas de branche par défaut, ce qui signale en général un dépôt vide.",
      evaluate: evaluateMetadata,
    },
  };

  return HEALTH_INDICATORS.map((indicator) => {
    const definition = definitions[indicator];
    const report: IndicatorReport<TProject> = {
      indicator,
      label: definition.label,
      rule: definition.rule,
      flagged: [],
      unavailable: [],
      fineCount: 0,
    };

    for (const project of projects) {
      const evaluation = definition.evaluate(project);

      if (evaluation.state === "flagged") {
        report.flagged.push({ project, detail: evaluation.detail });
      } else if (evaluation.state === "unavailable") {
        report.unavailable.push({ project, reason: evaluation.reason });
      } else {
        report.fineCount += 1;
      }
    }

    report.flagged.sort((left, right) => left.project.name.localeCompare(right.project.name));
    return report;
  });
}
