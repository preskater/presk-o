import Link from "next/link";
import { Badge, Card, EmptyState, Notice, TableShell, tdClass, thClass } from "@/components/ui";
import { formatInstant } from "@/lib/dates";
import {
  buildCiOverview,
  ciRunDurationSeconds,
  formatCiDuration,
  type CiOutcome,
} from "@/modules/integrations/ci";
import type { CiRepositorySummary } from "@/modules/integrations/repository";

const OUTCOME_BADGES: Record<CiOutcome, { tone: "negative" | "warning" | "neutral" | "positive"; label: string }> = {
  failure: { tone: "negative", label: "Échec" },
  running: { tone: "warning", label: "En cours" },
  other: { tone: "neutral", label: "Autre" },
  success: { tone: "positive", label: "Réussi" },
};

/**
 * CI status (DA-03): the latest GitHub Actions run of each workflow, most recently
 * started first. Failures are counted in a notice above the table, so an old failure
 * stays visible even when newer runs sort above it.
 *
 * Read-only: every row links to the provider, where re-running happens — this card
 * offers no such action. A repository whose CI could not be read is listed as
 * unavailable with the reason, never shown as passing.
 */
export function CiStatusCard({
  repositories,
  lastSyncedAt,
}: {
  repositories: CiRepositorySummary[];
  lastSyncedAt: Date | null;
}) {
  const overview = buildCiOverview(repositories);
  const notReadGitHub = overview.notRead.filter((repository) => repository.provider === "GITHUB");
  const notReadGitLab = overview.notRead.filter((repository) => repository.provider === "GITLAB");
  const failures = overview.latest.filter((entry) => entry.outcome === "failure").length;

  return (
    <Card
      title="Intégration continue"
      collapsible
      description={
        `Dernière exécution de chaque workflow GitHub Actions, de la plus récente à la plus ancienne.` +
        (lastSyncedAt ? ` Dernière lecture : ${formatInstant(lastSyncedAt)}.` : "")
      }
    >
      {overview.latest.length === 0 &&
      overview.withoutRuns.length === 0 &&
      overview.unavailable.length === 0 ? (
        <EmptyState
          title="Aucun état de CI lu"
          description="Rien n'a encore été lu : lancez une synchronisation GitHub. Un état vide ne signifie pas « tout est vert »."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {failures > 0 ? (
            <Notice tone="error">
              {failures} workflow(s) en échec sur leur dernière exécution.
            </Notice>
          ) : null}

          {overview.latest.length > 0 ? (
            <TableShell caption="Dernière exécution par workflow">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Workflow</th>
                  <th scope="col" className={thClass}>Résultat</th>
                  <th scope="col" className={thClass}>Branche</th>
                  <th scope="col" className={thClass}>Démarré</th>
                  <th scope="col" className={thClass}>Durée</th>
                </tr>
              </thead>
              <tbody>
                {overview.latest.map(({ repository, run, outcome }) => {
                  const duration = ciRunDurationSeconds(run);

                  return (
                    <tr key={run.id}>
                      <td className={tdClass}>
                        <Link
                          href={run.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {run.workflowName}
                        </Link>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {repository.repository}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <Badge tone={OUTCOME_BADGES[outcome].tone}>
                          {OUTCOME_BADGES[outcome].label}
                        </Badge>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {run.conclusion ?? run.status}
                        </span>
                      </td>
                      <td className={tdClass}>{run.branch ?? "—"}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {formatInstant(run.startedAt)}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {duration === null ? "en cours" : formatCiDuration(duration)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          ) : null}

          {overview.unavailable.length > 0 ? (
            <TableShell caption="CI indisponible">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Dépôt</th>
                  <th scope="col" className={thClass}>CI indisponible</th>
                </tr>
              </thead>
              <tbody>
                {overview.unavailable.map(({ repository, reason }) => (
                  <tr key={repository.repository}>
                    <td className={tdClass}>
                      <Link
                        href={repository.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline-offset-2 hover:underline"
                      >
                        {repository.repository}
                      </Link>
                    </td>
                    <td className={tdClass}>{reason}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          ) : null}

          {overview.withoutRuns.length > 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Aucune exécution récente :{" "}
              {overview.withoutRuns.map((repository) => repository.repository).join(", ")}.
            </p>
          ) : null}
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Lecture seule : relancer un workflow se fait sur GitHub.
        {notReadGitHub.length > 0
          ? ` ${notReadGitHub.length} dépôt(s) GitHub hors de la sélection lue (les plus récemment poussés d'abord) : leur CI est inconnue.`
          : ""}
        {notReadGitLab.length > 0
          ? ` Les pipelines GitLab ne sont pas encore lus (${notReadGitLab.length} projet(s)).`
          : ""}{" "}
        La durée va du démarrage à la dernière mise à jour : elle inclut l&apos;attente entre
        jobs.
      </p>
    </Card>
  );
}
