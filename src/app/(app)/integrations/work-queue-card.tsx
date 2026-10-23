import Link from "next/link";
import { SortableHeader } from "@/components/sortable-header";
import { Badge, Card, ChevronDown, EmptyState, Notice, TableShell, tdClass, thClass } from "@/components/ui";
import type { SearchParamsInput } from "@/lib/search-params";
import type { TableSort } from "@/lib/table-sort";
import { formatDateOnly, formatInstant } from "@/lib/dates";
import { describeAge } from "@/modules/integrations/issues";
import type {
  QueueMilestone,
  QueueSortKey,
  WorkQueue,
} from "@/modules/integrations/work-queue";

/**
 * The actionable work queue.
 *
 * "What needs attention now", computed from the issues and milestones already stored —
 * no extra provider call. Each bucket explains why it exists, and every item links to
 * the provider resource, which is where the reading happens.
 *
 * Pull request review state is not available at this scope (it lives on a provider
 * endpoint this integration does not read), so it is not offered: the queue signals
 * old pull requests by their age instead, and the footer says so plainly.
 */
export function WorkQueueCard({
  queue,
  issueTrackingConnected,
  lastSyncedAt,
  sort,
  params,
}: {
  queue: WorkQueue;
  /** Order of every bucket, from the `queueSort` URL parameter. */
  sort: TableSort<QueueSortKey>;
  /** Current URL parameters, kept by the sort links. */
  params: SearchParamsInput;
  /** True when at least one connection fetches issues (GitHub today). */
  issueTrackingConnected: boolean;
  /** Last successful synchronisation of those connections, if any. */
  lastSyncedAt: Date | null;
}) {
  const nonEmptyBuckets = queue.buckets.filter((bucket) => bucket.items.length > 0);
  const { overdue, dueSoon, dueSoonDays } = queue.milestones;
  const hasMilestones = overdue.length > 0 || dueSoon.length > 0;
  const nothingQueued = queue.totalItems === 0 && !hasMilestones;
  const sortProps = { sort, params, param: "queueSort", pathname: "/integrations" };

  return (
    <Card
      title="File d'attente"
      collapsible
      description={
        `Ce qui demande une décision maintenant : issues sans réponse, pull requests anciennes, travail sans jalon ni étiquette, tâches bloquées et jalons proches.` +
        (lastSyncedAt ? ` Dernière lecture : ${formatInstant(lastSyncedAt)}.` : "")
      }
    >
      {!issueTrackingConnected ? (
        <EmptyState
          title="Aucune connexion ne remonte d'issues"
          description="Un état vide ici ne signifie pas « rien à faire » : rien n'a encore été lu (GitHub remonte les issues et pull requests ouvertes)."
        />
      ) : nothingQueued ? (
        <Notice tone="info">
          Rien ne requiert votre attention dans la file : aucune issue sans réponse,
          aucune pull request ancienne, aucun jalon à échéance. C&apos;est un résultat, pas un
          manque de données.
        </Notice>
      ) : (
        <div className="flex flex-col gap-5">
          {nonEmptyBuckets.map((bucket) => (
            <details
              key={bucket.reason}
              open
              className="group/bucket rounded-md border border-zinc-100 dark:border-zinc-800/60"
            >
              <summary className="flex cursor-pointer list-none flex-col gap-1 p-3 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open/bucket:rotate-180" />
                  {bucket.label}
                  <Badge tone={bucket.reason === "unanswered" || bucket.reason === "blocked" ? "negative" : "warning"}>
                    {bucket.items.length}
                  </Badge>
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{bucket.rationale}</span>
              </summary>

              <div className="px-3 pb-3">
                <TableShell caption={bucket.label}>
                  <thead>
                    <tr>
                      <SortableHeader label="Sujet" column="subject" {...sortProps} />
                      <SortableHeader label="Assigné à" column="assignee" {...sortProps} />
                      <SortableHeader label="Ouverte depuis" column="age" {...sortProps} />
                    </tr>
                  </thead>
                  <tbody>
                    {bucket.items.map((item) => (
                      <tr key={item.issue.id}>
                        <td className={tdClass}>
                          <Link
                            href={item.issue.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {item.issue.title}
                          </Link>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                            {item.issue.repository} #{item.issue.number}
                          </span>
                          {item.issue.labels.length > 0 ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {item.issue.labels.map((label) => (
                                <Badge key={label} tone="neutral">
                                  {label}
                                </Badge>
                              ))}
                            </span>
                          ) : null}
                        </td>
                        <td className={tdClass}>
                          {item.issue.assignees.length === 0 ? (
                            <span className="text-zinc-500 dark:text-zinc-400">Personne</span>
                          ) : (
                            item.issue.assignees.join(", ")
                          )}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          {describeAge(item.ageDays)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </div>
            </details>
          ))}

          {hasMilestones ? (
            <details
              open
              className="group/bucket rounded-md border border-zinc-100 dark:border-zinc-800/60"
            >
              <summary className="flex cursor-pointer list-none flex-col gap-1 p-3 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open/bucket:rotate-180" />
                  Jalons à échéance
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Jalons ouverts en retard ou dont l&apos;échéance tombe dans les{" "}
                  {dueSoonDays} jours. Un jalon fermé ou sans date n&apos;apparaît pas.
                </span>
              </summary>

              <div className="px-3 pb-3">
                <TableShell caption="Jalons à échéance">
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>
                        Jalon
                      </th>
                      <th scope="col" className={thClass}>
                        État
                      </th>
                      <th scope="col" className={thClass}>
                        Échéance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((milestone) => (
                      <MilestoneRow key={`overdue-${milestone.repository}-${milestone.number}`} milestone={milestone} state="En retard" />
                    ))}
                    {dueSoon.map((milestone) => (
                      <MilestoneRow key={`soon-${milestone.repository}-${milestone.number}`} milestone={milestone} state="Bientôt" />
                    ))}
                  </tbody>
                </TableShell>
              </div>
            </details>
          ) : null}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            L&apos;état de revue d&apos;une pull request n&apos;est pas exposé dans ce
            périmètre (il demande un appel fournisseur supplémentaire) : cette file
            signale les pull requests par leur ancienneté, à défaut de pouvoir dire
            lesquelles attendent une revue. Une même ligne peut apparaître dans plusieurs
            rubriques.
          </p>
        </div>
      )}
    </Card>
  );
}

function MilestoneRow({
  milestone,
  state,
}: {
  milestone: QueueMilestone;
  state: "En retard" | "Bientôt";
}) {
  return (
    <tr>
      <td className={tdClass}>
        <Link
          href={milestone.url}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium underline-offset-2 hover:underline"
        >
          {milestone.title}
        </Link>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
          {milestone.repository} · {milestone.issuesClosed}/{milestone.issuesOpen + milestone.issuesClosed} fermées
        </span>
      </td>
      <td className={tdClass}>
        <Badge tone={state === "En retard" ? "negative" : "warning"}>{state}</Badge>
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>
        {milestone.dueOn ? formatDateOnly(milestone.dueOn) : "—"}
      </td>
    </tr>
  );
}
