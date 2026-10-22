import { Badge, Card, StatCard, TableShell, tdClass, thClass } from "@/components/ui";
import { formatDateOnly, formatInstant } from "@/lib/dates";
import { describeAge } from "@/modules/integrations/issues";
import type { ActivityMetrics, Unavailable } from "@/modules/integrations/metrics";

/**
 * Development activity metrics (DA-02).
 *
 * Bounded figures computed from the stored snapshots only. A metric that needs data
 * this integration does not keep is shown as unavailable, with the reason — never as
 * a zero. The footer states plainly that none of this measures people.
 */
export function ActivityMetricsCard({
  metrics,
  lastSyncedAt,
}: {
  metrics: ActivityMetrics;
  /** Last successful synchronisation of any connection, if any. */
  lastSyncedAt: Date | null;
}) {
  const { pullRequests, repositories, milestones } = metrics;
  const unavailable = [
    { label: "Délai ouverture → fusion", metric: metrics.openToMerge },
    { label: "Débit d'issues", metric: metrics.issueThroughput },
  ];
  const quiet = [...repositories.inactive, ...repositories.unknown];

  return (
    <Card
      title="Indicateurs d'activité"
      collapsible
      description={
        `Calculés sur les données enregistrées à la dernière synchronisation, âges mesurés à l'affichage.` +
        (lastSyncedAt ? ` Dernière lecture : ${formatInstant(lastSyncedAt)}.` : "")
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pullRequests.available ? (
          <>
            <StatCard
              label="Pull requests ouvertes"
              value={String(pullRequests.openCount)}
              hint="Au moment de la dernière synchronisation."
            />
            <StatCard
              label="Âge médian des PR ouvertes"
              value={
                pullRequests.medianAgeDays === null
                  ? "—"
                  : `${pullRequests.medianAgeDays.toLocaleString("fr-FR")} j`
              }
              hint={
                pullRequests.medianAgeDays === null
                  ? "Aucune pull request ouverte : pas de médiane."
                  : "Jours entiers depuis l'ouverture."
              }
            />
          </>
        ) : (
          <UnavailableStat label="Pull requests ouvertes" metric={pullRequests} />
        )}
        <StatCard
          label={`Dépôts inactifs (≥ ${repositories.inactiveDays} j)`}
          value={`${repositories.inactive.length} / ${
            repositories.inactive.length + repositories.active.length + repositories.unknown.length
          }`}
          tone={repositories.inactive.length > 0 ? "warning" : "neutral"}
          hint={
            repositories.unknown.length > 0
              ? `${repositories.unknown.length} sans date d'activité connue.`
              : "Dernière activité déclarée par le fournisseur."
          }
        />
        <StatCard
          label="Avancement des jalons ouverts"
          value={
            milestones.openCompletion === null
              ? "—"
              : `${Math.round(milestones.openCompletion * 100)} %`
          }
          hint={
            milestones.openCompletion === null
              ? "Aucun élément rattaché à un jalon ouvert."
              : `${milestones.openCount} jalon(s) ouvert(s), ${milestones.closedCount} fermé(s). Compteurs du fournisseur.`
          }
        />
        {unavailable.map(({ label, metric }) => (
          <UnavailableStat key={label} label={label} metric={metric} />
        ))}
      </div>

      {quiet.length > 0 ? (
        <div className="mt-4">
          <TableShell caption="Dépôts inactifs ou sans date d'activité">
            <thead>
              <tr>
                <th scope="col" className={thClass}>Dépôt</th>
                <th scope="col" className={thClass}>Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {quiet.map((repository) => (
                <tr key={repository.name}>
                  <td className={tdClass}>{repository.name}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {repository.lastActivityAt && repository.idleDays !== null ? (
                      <>
                        {formatDateOnly(repository.lastActivityAt)}
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {describeAge(repository.idleDays)}
                        </span>
                      </>
                    ) : (
                      <Badge tone="neutral">Inconnue</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Ces chiffres décrivent un backlog, pas le travail de personnes : ils ne mesurent
        pas la productivité. GitHub date l&apos;activité au dernier push, GitLab à la
        dernière activité du projet (issues et merge requests comprises).
      </p>
    </Card>
  );
}

function UnavailableStat({ label, metric }: { label: string; metric: Unavailable }) {
  return <StatCard label={label} value="Indisponible" hint={metric.reason} />;
}
