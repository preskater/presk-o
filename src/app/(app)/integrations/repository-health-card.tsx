import Link from "next/link";
import { Badge, Card, ChevronDown, Notice } from "@/components/ui";
import { formatInstant } from "@/lib/dates";
import { groupUnavailable, type IndicatorReport } from "@/modules/integrations/health";
import type { ProjectSummary } from "@/modules/integrations/repository";

/**
 * Repository health (DA-05): small hygiene gaps as a to-do list.
 *
 * Each indicator shows its rule, the repositories it flags (linked to the provider,
 * where the fix happens) and how many could not be judged. Nothing here writes to the
 * provider and nothing adds up to a score: the indicators are independent.
 */
export function RepositoryHealthCard({
  reports,
  lastSyncedAt,
}: {
  reports: IndicatorReport<ProjectSummary>[];
  lastSyncedAt: Date | null;
}) {
  const flaggedTotal = reports.reduce((sum, report) => sum + report.flagged.length, 0);

  return (
    <Card
      title="Santé des dépôts"
      collapsible
      description={
        "Petits manques d'hygiène à corriger chez le fournisseur. Lecture seule : chaque dépôt renvoie vers GitHub ou GitLab." +
        (lastSyncedAt ? ` Données de la synchronisation du ${formatInstant(lastSyncedAt)}.` : "")
      }
    >
      <div className="flex flex-col gap-3">
        {flaggedTotal === 0 ? (
          <Notice tone="info">
            Aucun indicateur ne signale de dépôt. Les dépôts que les données ne permettent
            pas de juger sont comptés à part, jamais comme conformes.
          </Notice>
        ) : null}

        {reports.map((report) => (
          <details
            key={report.indicator}
            open={report.flagged.length > 0}
            className="group/indicator rounded-md border border-zinc-100 dark:border-zinc-800/60"
          >
            <summary className="flex cursor-pointer list-none flex-col gap-1 p-3 [&::-webkit-details-marker]:hidden">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open/indicator:rotate-180" />
                {report.label}
                <Badge tone={report.flagged.length > 0 ? "warning" : "neutral"}>
                  {report.flagged.length}
                </Badge>
                {report.unavailable.length > 0 ? (
                  <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    {report.unavailable.length} non évalué(s)
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Règle : {report.rule}</span>
            </summary>

            <div className="flex flex-col gap-2 px-3 pb-3 text-sm">
              {report.flagged.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {report.flagged.map(({ project, detail }) => (
                    <li key={`${project.connectionId}-${project.name}`}>
                      <Link
                        href={project.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {project.name}
                      </Link>{" "}
                      <span className="text-zinc-600 dark:text-zinc-300">— {detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-zinc-600 dark:text-zinc-300">
                  Aucun dépôt signalé ({report.fineCount} conforme(s)).
                </p>
              )}

              {groupUnavailable(report.unavailable).map(({ reason, projects }) => (
                <p key={reason} className="text-xs text-zinc-500 dark:text-zinc-400">
                  Non évalués : {projects.map((project) => project.name).join(", ")} — {reason}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}
