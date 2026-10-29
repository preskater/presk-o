import Link from "next/link";
import { SearchForm } from "@/components/search-form";
import {
  Badge,
  EmptyState,
  Notice,
  PageHeader,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { formatInstant } from "@/lib/dates";
import { readSearchParam, type SearchParamsInput } from "@/lib/search-params";
import { hasModule } from "@/modules/catalog/catalog";
import { STALE_AFTER_HOURS } from "@/modules/integrations/domain";
import {
  normalizeSearchQuery,
  providerNames,
  searchableKinds,
  SEARCH_KIND_LABELS,
  SEARCH_KIND_SEE_ALL_LABELS,
  SEARCH_MIN_QUERY_LENGTH,
  type ProviderSearchState,
} from "@/modules/search/domain";
import { getProviderSearchState, searchAll } from "@/modules/search/repository";

export const dynamic = "force-dynamic";

/**
 * One entry point across the modules this workspace activated (UX-01).
 *
 * The query is read on the server and every result is loaded owner-scoped; the page
 * never receives rows from another workspace. Each kind is bounded, and provider
 * results come from the stored snapshots, so their freshness is stated rather than
 * implied. "Nothing matched", "not connected" and "synchronisation failed" are three
 * different messages.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const rawQuery = readSearchParam(params, "q");
  const query = normalizeSearchQuery(rawQuery);
  const development = hasModule(user.workspace, "development");
  const kinds = searchableKinds({
    budget: hasModule(user.workspace, "budget"),
    realEstate: hasModule(user.workspace, "real-estate"),
    development,
  });

  const [results, provider] = await Promise.all([
    query && kinds.length > 0
      ? searchAll({ workspaceId: user.workspace.id, query, kinds })
      : null,
    query && development ? getProviderSearchState(user.workspace.id) : null,
  ]);

  const tooShort = !query && (rawQuery?.trim().length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Recherche"
        description="Opérations, comptes, biens immobiliers, projets, tickets et jalons de cet espace. Les résultats sont limités par type."
      />

      <SearchForm
        id="page-search"
        defaultValue={rawQuery ?? ""}
        className="w-full sm:max-w-xl"
      />

      {kinds.length === 0 ? (
        <EmptyState
          title="Aucun module à rechercher"
          description={
            <>
              Aucun module interrogeable n&apos;est actif dans cet espace. Activez le
              budget, l&apos;immobilier ou le développement depuis les{" "}
              <Link href="/modules" className="underline underline-offset-2">
                modules
              </Link>
              .
            </>
          }
        />
      ) : !query || !results ? (
        <EmptyState
          title={tooShort ? "Recherche trop courte" : "Rechercher dans vos données"}
          description={
            tooShort
              ? `Saisissez au moins ${SEARCH_MIN_QUERY_LENGTH} caractères.`
              : "Saisissez un mot ou une partie de libellé, de nom de compte, de bien, de projet, de ticket ou de jalon."
          }
        />
      ) : (
        <>
          {provider ? <ProviderNotice state={provider} /> : null}

          {results.total === 0 ? (
            <EmptyState
              title="Aucun résultat"
              description={emptyDescription(query, provider)}
            />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {results.total} résultat{results.total > 1 ? "s" : ""} affiché
              {results.total > 1 ? "s" : ""} pour « {query} ».
            </p>
          )}

          {results.groups.map((group) => {
            const headingId = `search-group-${group.kind}`;

            return (
              <section
                key={group.kind}
                aria-labelledby={headingId}
                className="flex flex-col gap-2"
              >
                <h2
                  id={headingId}
                  className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  {SEARCH_KIND_LABELS[group.kind]}
                  <Badge tone="neutral">
                    {group.items.length}
                    {group.truncated ? "+" : ""}
                  </Badge>
                </h2>

                <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <TableShell caption={SEARCH_KIND_LABELS[group.kind]}>
                    <thead>
                      <tr>
                        <th className={thClass}>Résultat</th>
                        <th className={thClass}>Détail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.id}>
                          <td className={tdClass}>
                            {item.external ? (
                              <a
                                href={item.href}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="font-medium underline-offset-2 hover:underline"
                              >
                                {item.title}
                              </a>
                            ) : (
                              <Link
                                href={item.href}
                                className="font-medium underline-offset-2 hover:underline"
                              >
                                {item.title}
                              </Link>
                            )}
                          </td>
                          <td className={tdClass}>
                            {item.detail ? (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {item.detail}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                </div>

                {group.truncated ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Seuls les {group.items.length} premiers résultats sont affichés.{" "}
                    <Link href={group.seeAllHref} className="underline underline-offset-2">
                      {SEARCH_KIND_SEE_ALL_LABELS[group.kind]}
                    </Link>
                  </p>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </>
  );
}

/**
 * A failed synchronisation is not "no results": it says the provider half of the search
 * was incomplete, with its last successful date and a way to fix it.
 */
function ProviderNotice({ state }: { state: ProviderSearchState }) {
  if (state.kind === "ok") {
    if (!state.stale) {
      return (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Dernière synchronisation des fournisseurs : {formatInstant(state.lastSyncedAt)}.
        </p>
      );
    }

    return (
      <Notice tone="warning">
        Dernière synchronisation des fournisseurs : {formatInstant(state.lastSyncedAt)} —
        plus de {STALE_AFTER_HOURS} heures. Ces résultats peuvent être obsolètes.{" "}
        <Link href="/integrations" className="underline underline-offset-2">
          Ouvrez les intégrations
        </Link>
      </Notice>
    );
  }

  if (state.kind === "not_connected") {
    return (
      <Notice tone="info">
        Aucune connexion GitHub ou GitLab : les projets, tickets et jalons ne sont pas
        recherchés.{" "}
        <Link href="/integrations" className="underline underline-offset-2">
          Ouvrir les intégrations
        </Link>
      </Notice>
    );
  }

  if (state.kind === "never_synced") {
    return (
      <Notice tone="warning">
        Synchronisation jamais réussie pour {providerNames(state.providers)} : les projets,
        tickets et jalons ne figurent pas dans ces résultats.{" "}
        <Link href="/integrations" className="underline underline-offset-2">
          Ouvrir les intégrations
        </Link>
      </Notice>
    );
  }

  return (
    <Notice tone="error">
      La dernière synchronisation a échoué pour {providerNames(state.providers)} : les
      projets, tickets et jalons peuvent manquer.
      {state.lastSyncedAt
        ? ` Dernière synchronisation réussie : ${formatInstant(state.lastSyncedAt)}.`
        : " Aucune synchronisation n'a encore réussi."}{" "}
      <Link href="/integrations" className="underline underline-offset-2">
        Ouvrir les intégrations
      </Link>
    </Notice>
  );
}

function emptyDescription(query: string, provider: ProviderSearchState | null): string {
  const base = `Aucune donnée de cet espace ne correspond à « ${query} ».`;

  if (!provider) {
    return base;
  }

  switch (provider.kind) {
    case "error":
      return `${base} Les résultats des fournisseurs sont indisponibles : voir l'erreur de synchronisation ci-dessus.`;
    case "never_synced":
      return `${base} Les projets, tickets et jalons n'ont pas encore été synchronisés.`;
    case "not_connected":
      return `${base} Aucune connexion GitHub ou GitLab n'est configurée.`;
    default:
      return base;
  }
}
