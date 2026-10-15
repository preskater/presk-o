import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly } from "@/lib/dates";
import {
  ageInDays,
  describeAge,
  isRecent,
  isUnanswered,
  type IssueFilters,
  type IssueSort,
} from "@/modules/integrations/issues";
import type { IssueSummary } from "@/modules/integrations/repository";
import { IssueFiltersForm } from "./issue-filters-form";

/**
 * The issue and pull request explorer.
 *
 * The whole point is to be narrowable: one repository, one assignee, one milestone, the
 * items nobody picked up. The filters are URL parameters, so a view is shareable,
 * bookmarkable, and survives a reload — and nothing needs client-side state.
 *
 * Only titles, links and metadata are shown: descriptions and comments stay at GitHub,
 * which is where the permissions and the context are.
 */
const DISPLAY_LIMIT = 100;

export function IssueExplorer({
  issues,
  totalCount,
  filters,
  options,
}: {
  /** Already filtered and sorted by the page. */
  issues: IssueSummary[];
  /** Everything followed, so the count can say how much was filtered out. */
  totalCount: number;
  filters: IssueFilters;
  options: {
    repositories: string[];
    assignees: string[];
    labels: string[];
    milestones: string[];
    hasUnassigned: boolean;
    hasWithoutMilestone: boolean;
  };
}) {
  const now = new Date();
  const displayed = issues.slice(0, DISPLAY_LIMIT);
  const activeCount = countActiveFilters(filters);

  return (
    <Card
      title="Explorer les issues et pull requests"
      collapsible
      description="Filtres combinables : dépôt, type, assigné, étiquette, jalon, état. Le texte des issues reste chez GitHub, seuls les titres et les métadonnées sont repris ici."
    >
      <div className="flex flex-col gap-4">
        <IssueFiltersForm filters={filters} options={options} />

        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {issues.length === 0
            ? `Aucun résultat sur ${totalCount} issue(s) suivie(s).`
            : `${issues.length} résultat(s) sur ${totalCount} suivie(s)`}
          {activeCount > 0 ? ` · ${activeCount} filtre(s) actif(s)` : ""}
          {issues.length > DISPLAY_LIMIT
            ? ` · ${DISPLAY_LIMIT} premières affichées : affinez les filtres pour voir les autres.`
            : ""}
        </p>

        {displayed.length === 0 ? (
          <EmptyState
            title="Aucune issue ne correspond"
            description="Les filtres sont exhaustifs : élargissez-en un, ou réinitialisez pour revenir à la liste complète."
          />
        ) : (
          <TableShell caption="Issues et pull requests filtrées">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Type
                </th>
                <th scope="col" className={thClass}>
                  Sujet
                </th>
                <th scope="col" className={thClass}>
                  Assigné à
                </th>
                <th scope="col" className={thClass}>
                  Jalon
                </th>
                <th scope="col" className={thClass}>
                  Étiquettes
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Comm.
                </th>
                <th scope="col" className={thClass}>
                  Ouverte
                </th>
                <th scope="col" className={thClass}>
                  Activité
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((issue) => (
                <tr key={issue.id}>
                  <td className={tdClass}>
                    <Badge tone={issue.kind === "PULL_REQUEST" ? "neutral" : "positive"}>
                      {issue.kind === "PULL_REQUEST" ? "PR" : "Issue"}
                    </Badge>
                  </td>
                  <td className={tdClass}>
                    <Link
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {issue.title}
                    </Link>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {issue.repository} #{issue.number} · ouvert par{" "}
                      {issue.authorLogin ?? "inconnu"}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {isRecent(issue, now, 14) ? <Badge tone="positive">Nouvelle</Badge> : null}
                      {isUnanswered(issue, now, 3) ? (
                        <Badge tone="negative">Sans réponse</Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {issue.assignees.length === 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">Personne</span>
                    ) : (
                      issue.assignees.join(", ")
                    )}
                  </td>
                  <td className={tdClass}>
                    {issue.milestone ?? (
                      <span className="text-zinc-500 dark:text-zinc-400">Aucun</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    {issue.labels.length === 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">Aucune</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {issue.labels.map((label) => (
                          <Badge key={label} tone="neutral">
                            {label}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {issue.commentsCount}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(issue.openedAt)}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {describeAge(ageInDays(issue.openedAt, now))}
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(issue.activityAt)}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {describeAge(ageInDays(issue.activityAt, now))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </Card>
  );
}

/** The number of criteria currently narrowing the list, shown next to the count. */
function countActiveFilters(filters: IssueFilters): number {
  return [
    filters.repository,
    filters.kind,
    filters.assignee,
    filters.label,
    filters.milestone,
    filters.query,
    filters.sort && filters.sort !== ("recent" satisfies IssueSort) ? filters.sort : undefined,
    ...(filters.flags ?? []),
  ].filter((value) => value !== undefined && value !== "").length;
}

